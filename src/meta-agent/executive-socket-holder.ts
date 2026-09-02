type WASocket = any;

let activeExecutiveSocket: WASocket | null = null;
let currentExecutiveQr: string | null = null;
let currentExecutiveStatus: "connecting" | "open" | "close" = "close";

export function setExecutiveSocket(sock: WASocket | null): void {
  activeExecutiveSocket = sock;
}

export function getExecutiveSocket(): WASocket | null {
  return activeExecutiveSocket;
}

export function setExecutiveQr(qr: string | null): void {
  currentExecutiveQr = qr;
}

export function getExecutiveQr(): string | null {
  return currentExecutiveQr;
}

export function setExecutiveStatus(status: "connecting" | "open" | "close"): void {
  currentExecutiveStatus = status;
}

export function getExecutiveStatus(): "connecting" | "open" | "close" {
  return currentExecutiveStatus;
}
