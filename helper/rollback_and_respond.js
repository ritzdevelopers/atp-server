export async function rollbackAndRespond(connection, res, status, message) {
  if (connection) await connection.rollback();
  return res.status(status).json({ message });
}
