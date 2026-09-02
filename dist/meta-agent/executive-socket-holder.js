let activeExecutiveSocket = null;
let currentExecutiveQr = null;
let currentExecutiveStatus = "close";
export function setExecutiveSocket(sock) {
    activeExecutiveSocket = sock;
}
export function getExecutiveSocket() {
    return activeExecutiveSocket;
}
export function setExecutiveQr(qr) {
    currentExecutiveQr = qr;
}
export function getExecutiveQr() {
    return currentExecutiveQr;
}
export function setExecutiveStatus(status) {
    currentExecutiveStatus = status;
}
export function getExecutiveStatus() {
    return currentExecutiveStatus;
}
//# sourceMappingURL=executive-socket-holder.js.map