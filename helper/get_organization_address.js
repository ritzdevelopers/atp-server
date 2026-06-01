import db from "../db/connect.js";

const get_org_address_helper = async (org_id) => {
    try {
        const [addresses] = await db.promise().query("SELECT * FROM organization_address WHERE org_id = ? ORDER BY created_at DESC, id DESC", [org_id]);
        const address = addresses ?? [];
        return address;
    } catch (error) {
        console.log("Error in get_org_address_helper: ", error);
        return null;
    }
}

export default get_org_address_helper;