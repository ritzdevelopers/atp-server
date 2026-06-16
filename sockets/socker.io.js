export const register_socket_io = (io) => {
  io.on("connection", (socket) => {
    console.log("Socket Io Connected", socket.id);
    socket.on("disconnect", () => {
      console.log("Socket Io Disconnected", socket.id);
    });
  });
};
