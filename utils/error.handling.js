function errorHandling(connection, res, success, message, error, statusCode) {
    if (connection) {
        connection.rollback();
    }
    return res.status(statusCode).json({
        success: success,
        message: message,
        error: error.message,
    });
}

export default errorHandling;