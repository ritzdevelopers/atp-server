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

    const decoded = jwt.verify(token, process.env.JWT_SECRET); 

    req.user = decoded;
    next();
  } catch (error) {
    console.error("Error validating user: ", error);
    return res.status(401).json({ message: "Invalid token" });
  }
};

export default user_validation_middleware;