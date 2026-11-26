import type { VaultEntry } from '../core/types';
import { sanitizeForAI, verifyZeroLeakage } from '../vault/anonymizer';
import {
  extractReceiptFields,
  redactReceiptPII,
  type ExtractedReceiptFields,
} from './receiptHeuristics';

/**
 * Pipeline Seguro de Lançamento por Foto:
 *   1. OCR LOCAL no navegador (tesseract.js para imagens · pdf.js para PDFs com texto).
 *      A imagem nunca sai do dispositivo para fazer OCR.
 *   2. Extração local de data, valor e CNPJ do emissor a partir do texto bruto.
 *   3. Sanitização em duas camadas: redactReceiptPII (CPF/CNPJ/telefone/endereço/razão social)
 *      + sanitizeForAI do Cofre (nomes de empresas, contas, produtos e projetos → tokens).
 *   4. Só o texto sanitizado vai ao servidor para classificação (que revalida contra o cofre).
 */

export interface OcrProgress {
  stage: 'loading' | 'recognizing' | 'pdf' | 'done';
  progress: number; // 0..1
  message: string;
}

export interface LocalOcrResult {
  rawText: string;
  confidence: number; // 0..100
  engine: 'tesseract' | 'pdfjs';
}

export interface SanitizedReceipt {
  extracted: ExtractedReceiptFields;
  sanitizedText: string;
  redactions: number;
  zeroLeakVerified: boolean;
  leakedTerms: string[];
}

const MAX_OCR_IMAGE_SIDE = 2200;

/** Reduz imagens muito grandes (fotos de 12MP) para acelerar o OCR sem perder legibilidade. */
async function downscaleImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_OCR_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.9));
  } catch {
    return file;
  }
}

export async function extractPdfText(data: ArrayBuffer, maxPages = 10): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
  const doc = await loadingTask.promise;
  const pages: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      } else {
        line += ' ';
      }
    }
    if (line.trim()) lines.push(line);
    pages.push(lines.join('\n'));
  }
  await loadingTask.destroy();
  return pages.join('\n');
}

export async function runLocalOcr(file: File, onProgress?: (p: OcrProgress) => void): Promise<LocalOcrResult> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    onProgress?.({ stage: 'pdf', progress: 0.3, message: 'Lendo texto do PDF localmente…' });
    const text = await extractPdfText(await file.arrayBuffer());
    if (text.replace(/\s+/g, '').length < 20) {
      throw new Error('O PDF não contém texto selecionável (é uma imagem escaneada). Envie uma foto ou print do comprovante.');
    }
    onProgress?.({ stage: 'done', progress: 1, message: 'Texto extraído.' });
    return { rawText: text, confidence: 99, engine: 'pdfjs' };
  }

  onProgress?.({ stage: 'loading', progress: 0.05, message: 'Carregando motor de OCR (português)…' });
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('por', 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress?.({ stage: 'recognizing', progress: 0.2 + m.progress * 0.8, message: 'Reconhecendo texto no dispositivo…' });
      } else if (typeof m.progress === 'number') {
        onProgress?.({ stage: 'loading', progress: Math.min(0.2, m.progress * 0.2), message: 'Carregando motor de OCR (português)…' });
      }
    },
  });
  try {
    const image = await downscaleImage(file);
    const { data } = await worker.recognize(image);
    onProgress?.({ stage: 'done', progress: 1, message: 'Texto reconhecido.' });
    return { rawText: data.text ?? '', confidence: Number(data.confidence ?? 0), engine: 'tesseract' };
  } finally {
    await worker.terminate();
  }
}

/**
 * Extrai campos do texto bruto e devolve o texto pronto para sair do dispositivo.
 * Função pura (testável): não faz rede nem acessa DOM.
 */
export function prepareReceiptForAI(
  rawText: string,
  vault: readonly VaultEntry[],
  extraSensitiveTerms: readonly string[] = [],
  todayISO?: string
): SanitizedReceipt {
  const extracted = extractReceiptFields(rawText, todayISO);
  const { text: piiFree, redactions } = redactReceiptPII(rawText);
  const { sanitized, report } = sanitizeForAI(piiFree, vault, { counterpartyNames: [...extraSensitiveTerms] });
  const finalCheck = verifyZeroLeakage(sanitized, vault, extraSensitiveTerms);
  return {
    extracted,
    sanitizedText: sanitized.slice(0, 6000),
    redactions: redactions + report.redactionsCount,
    zeroLeakVerified: finalCheck.clean && report.zeroLeakageVerified,
    leakedTerms: Array.from(new Set([...finalCheck.leakedTerms, ...report.leakedTerms])),
  };
}
