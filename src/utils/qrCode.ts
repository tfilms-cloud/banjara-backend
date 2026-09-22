/** Placeholder QR payload generator — replace with real QR library later. */
export function buildTicketQrPayload(bookingNumber: string): string {
  return `BANJARA|TICKET|${bookingNumber}|${Date.now()}`;
}

export function buildTicketQrDataUrl(bookingNumber: string): string {
  // Frontend can render this string as a QR; real image encoding can be added later.
  const payload = encodeURIComponent(buildTicketQrPayload(bookingNumber));
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${payload}`;
}
