import { pool } from "../../db/connect";

export const get_left_side_bar_features_controller = async (req, res) => { 
    let connection;
    try {
        connection = await pool.promise().getConnection();
        await connection.beginTransaction();

        const {user_id: action_user_id} = req.user;
        const {org_id} = req;

        
        
    } catch (error) {
        
    } finally {
        if(connection) { 
            connection.release();
        }
    }
}