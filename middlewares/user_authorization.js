const user_authorization = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      if (!allowedRoles.includes(user.user_role_name)) {
        return res.status(403).json({ message: "Forbidden" });
      }
      next();
    } catch (error) {
      console.error("Error authorizing user: ", error);
      return res.status(500).json({ message: "Error authorizing user" });
    }
  };
};

export default user_authorization;