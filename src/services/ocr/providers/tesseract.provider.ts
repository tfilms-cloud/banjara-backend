import type { OcrExtractResult, OcrProvider } from '../ocr.types';

/**
 * Local OCR via tesseract.js — no third-party API key required.
 * General text pass + digits whitelist pass for CNIC / dates.
 */
export class TesseractOcrProvider implements OcrProvider {
  readonly name = 'tesseract';

  async extractText(image: Buffer): Promise<OcrExtractResult> {
    const { createWorker } = await import('tesseract.js');
    // tesseract.js always invokes logger(...) — must be a function, never undefined
    const worker = await createWorker('eng', 1, {
      logger: () => undefined,
    });
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: '6' as never,
        preserve_interword_spaces: '1' as never,
      });
      const primary = await worker.recognize(image);
      const primaryText = (primary.data.text ?? '').trim();

      // Digits-only pass — recovers Identity Number / dates on busy card backgrounds
      await worker.setParameters({
        tessedit_pageseg_mode: '6' as never,
        tessedit_char_whitelist: '0123456789-./ ' as never,
        preserve_interword_spaces: '1' as never,
      });
      const digits = await worker.recognize(image);
      const digitText = (digits.data.text ?? '').trim();

      const text = [primaryText, digitText].filter(Boolean).join('\n');
      const confidence =
        typeof primary.data.confidence === 'number'
          ? Math.max(0, Math.min(1, primary.data.confidence / 100))
          : null;

      return {
        text,
        provider: this.name,
        confidence,
      };
    } finally {
      await worker.terminate().catch(() => undefined);
    }
  }
}
