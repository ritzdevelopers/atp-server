import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const user_validation_middleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    req.user = decoded;
    next();
  } catch (error) {
    console.error("Error validating user: ", error);
    return res.status(500).json({ message: "Error validating user" });
  }
};

export default user_validation_middleware;
