let ioInstance = null;

export function setSocketIo(io) {
  ioInstance = io;
}

export function getSocketIo() {
  return ioInstance;
}
