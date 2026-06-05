import { isEmployeeExists } from "../helper/employee_checker.js";
import { pool } from "../db/connect.js";
import errorHandling from "../utils/error.handling";

const left_side_featuures = (feature_value, sub_feature_value)=>{
    return async(req, res, next)=>{
        let connection;
        try {
            connection = await pool.promise().getConnection();
            await connection.beginTransaction();
            const {user_id: action_user} = req.user;
            if(!(await isEmployeeExists(connection, action_user))) {
                return errorHandling(connection, false, "Employee Not Found", new Error("Employee Not Found"), 404);
            }
            const {org_id} = req;
            if(!org_id) {
                return errorHandling(connection, false, "Organization Not Found", new Error("Organization Not Found"), 404);
            }

        } catch (error) { 
            if(connection) { 
                return errorHandling(connection, false, "Internal Server Error", error, 500);
            }
            return res.status(500).json({
                success: false,
                message: "Internal Server Error",
                data: null,
            });
        } finally {
            if(connection) { 
                connection.release();
            }
        }
    } 
}