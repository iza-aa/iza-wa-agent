type WASocket = any;

let activeSocket: WASocket | null = null;

export function setGlobalSocket(sock: WASocket | null): void {
  activeSocket = sock;
}

export function getGlobalSocket(): WASocket | null {
  return activeSocket;
}
