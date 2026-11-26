import type { WorkspaceCfoSource } from '../../../src/modules/ai-cfo/cfoAgent.ts';
import { addDaysISO } from './dateUtils.ts';
import { sha256Hex } from '../../crypto/secretBox.ts';
import { getSupabaseAdmin } from '../../supabaseAdmin.ts';
import { deleteCalendarEvent, upsertCalendarEvent } from '../google/googleClient.ts';
import { buildAgendaItems, formatBRL, pickLabel, type AgendaItem } from './agendaBuilder.ts';

/**
 * Sincroniza vencimentos críticos (contas a pagar, parcelas de dívidas, impostos) e marcos
 * de projetos (início, fim, payback previsto) com o Google Calendar do titular.
 * Idempotente: cada item de origem mapeia para 1 evento (calendar_sync_items) e só é
 * reenviado quando o conteúdo muda (content_hash). Itens pagos/cancelados têm o evento removido.
 */

interface SyncMapping {
  id: string;
  source_type: string;
  source_id: string;
  google_event_id: string;
  content_hash: string;
  event_date: string;
}

export interface CalendarSyncResult {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  errors: string[];
}

const COLOR_BY_KIND: Record<string, string> = {
  payable: '6',
  debt: '5',
  tax: '3',
  project: '9',
};

function eventContent(item: AgendaItem, includeReal: boolean): { summary: string; description: string } {
  const label = pickLabel(item, includeReal);
  const amount = item.amount !== null ? ` — ${formatBRL(item.amount)}` : '';
  const prefix = item.status === 'overdue' ? '⚠ ATRASADO · ' : '';
  return {
    summary: `${prefix}${label}${amount}`,
    description: [
      `Origem: Vértice (${item.sourceType})`,
      `Empresa: ${item.companyToken}`,
      includeReal ? '' : 'Rótulos anonimizados (tokens do Cofre). Abra o Vértice para ver os nomes reais.',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

export async function syncCalendarForTenant(params: {
  tenantId: string;
  workspace: WorkspaceCfoSource;
  calendarId: string;
  daysAhead: number;
  includeRealLabels: boolean;
  todayISO: string;
}): Promise<CalendarSyncResult> {
  const admin = getSupabaseAdmin();
  const fromISO = addDaysISO(params.todayISO, -7);
  const toISO = addDaysISO(params.todayISO, params.daysAhead);
  const items = buildAgendaItems(params.workspace, { todayISO: params.todayISO, fromISO, toISO }).filter(
    (i) => i.kind !== 'receivable'
  );

  const { data: mapData, error: mapErr } = await admin
    .from('calendar_sync_items')
    .select('id, source_type, source_id, google_event_id, content_hash, event_date')
    .eq('tenant_id', params.tenantId);
  if (mapErr) throw new Error(mapErr.message);
  const mappings = new Map(((mapData ?? []) as SyncMapping[]).map((m) => [`${m.source_type}:${m.source_id}`, m]));

  const result: CalendarSyncResult = { created: 0, updated: 0, deleted: 0, unchanged: 0, errors: [] };
  const seen = new Set<string>();

  for (const item of items) {
    const key = `${item.sourceType}:${item.sourceId}`;
    seen.add(key);
    const content = eventContent(item, params.includeRealLabels);
    const hash = sha256Hex(`${content.summary}|${item.date}|${content.description}|${params.calendarId}`);
    const existing = mappings.get(key);
    if (existing && existing.content_hash === hash) {
      result.unchanged += 1;
      continue;
    }
    try {
      const eventId = await upsertCalendarEvent(params.tenantId, params.calendarId, existing?.google_event_id ?? null, {
        summary: content.summary,
        description: content.description,
        date: item.date,
        colorId: item.status === 'overdue' ? '11' : COLOR_BY_KIND[item.kind],
        privateKey: key,
      });
      const { error } = await admin.from('calendar_sync_items').upsert(
        {
          tenant_id: params.tenantId,
          source_type: item.sourceType,
          source_id: item.sourceId,
          google_event_id: eventId,
          content_hash: hash,
          event_date: item.date,
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,source_type,source_id' }
      );
      if (error) throw new Error(error.message);
      if (existing) result.updated += 1;
      else result.created += 1;
    } catch (err) {
      result.errors.push(`${key}: ${err instanceof Error ? err.message : 'erro'}`);
    }
  }

  // Remove eventos de itens que saíram da agenda (pagos, cancelados, excluídos) dentro da janela
  for (const [key, mapping] of mappings) {
    if (seen.has(key)) continue;
    if (mapping.event_date < fromISO) continue; // histórico fora da janela: mantém o evento
    try {
      await deleteCalendarEvent(params.tenantId, params.calendarId, mapping.google_event_id);
      await admin.from('calendar_sync_items').delete().eq('id', mapping.id).eq('tenant_id', params.tenantId);
      result.deleted += 1;
    } catch (err) {
      result.errors.push(`${key}: ${err instanceof Error ? err.message : 'erro ao remover'}`);
    }
  }

  await admin
    .from('notification_preferences')
    .update({ last_calendar_sync_at: new Date().toISOString() })
    .eq('tenant_id', params.tenantId);

  return result;
}
