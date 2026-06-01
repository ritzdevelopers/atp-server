// import cron from "node-cron";
// import db from "./db/connect.js";

// cron.schedule("0 0 1 * *", async () => {
//   console.log("Running Monthly Leave Assignment Job...");

//   let connection;

//   try {
//     connection = await db.promise().getConnection();

//     const now = new Date();

//     const year = now.getFullYear();
//     const month = now.getMonth() + 1;

//     // Get all company leave configurations
//     const [companyLeaves] = await connection.query(`
//       SELECT 
//         user_id,
//         org_id,
//         leaves_per_month
//       FROM company_leave_sheet
//     `);

//     if (companyLeaves.length === 0) {
//       console.log("No leave configurations found");
//       return;
//     }

//     for (const leaveData of companyLeaves) {

//       const {
//         user_id,
//         org_id,
//         leaves_per_month
//       } = leaveData;

//       // Check if leave balance already exists for current month
//       const [existingBalance] = await connection.query(
//         `
//         SELECT id 
//         FROM leave_balance
//         WHERE user_id = ?
//         AND org_id = ?
//         AND year = ?
//         AND month = ?
//         `,
//         [user_id, org_id, year, month]
//       );

//       // If not exists -> create new monthly balance
//       if (existingBalance.length === 0) {

//         await connection.query(
//           `
//           INSERT INTO leave_balance (
//             user_id,
//             org_id,
//             year,
//             month,
//             total_leaves,
//             used_leaves,
//             remaining_leaves,
//             last_leave_update
//           )
//           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
//           `,
//           [
//             user_id,
//             org_id,
//             year,
//             month,
//             leaves_per_month,
//             0,
//             leaves_per_month
//           ]
//         );

//         console.log(
//           `Leaves assigned to User ${user_id} for Month ${month}`
//         );

//       }

//       // If already exists -> update leave balance
//       else {

//         await connection.query(
//           `
//           UPDATE leave_balance
//           SET
//             total_leaves = ?,
//             remaining_leaves = ?,
//             last_leave_update = NOW()
//           WHERE user_id = ?
//           AND org_id = ?
//           AND year = ?
//           AND month = ?
//           `,
//           [
//             leaves_per_month,
//             leaves_per_month,
//             user_id,
//             org_id,
//             year,
//             month
//           ]
//         );

//         console.log(
//           `Leaves updated for User ${user_id} for Month ${month}`
//         );
//       }
//     }

//     console.log("Monthly leave assignment completed successfully");

//   } catch (error) {

//     console.error(
//       "CRON ERROR IN MONTHLY LEAVE ASSIGNMENT:",
//       error
//     );

//   } finally {

//     if (connection) {
//       connection.release();
//     }
//   }
// });