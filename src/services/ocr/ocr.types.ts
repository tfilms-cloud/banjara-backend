export type OcrExtractResult = {
  text: string;
  provider: string;
  /** Overall OCR confidence 0–1 when available */
  confidence: number | null;
};

export interface OcrProvider {
  readonly name: string;
  extractText(image: Buffer, mimeType?: string): Promise<OcrExtractResult>;
}
