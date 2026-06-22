import db, { pool } from "../db/connect";
import cron from "node-cron";

cron.schedule("0 0 1 * *", async () => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();
    const orgs = await get_all_orgs_ids(connection);
    if (!orgs) {
      await connection.rollback();
      return;
    }
    const date = new Date();
    let year = date.getFullYear();
    let month = date.getMonth() + 1;
    let day = date.getDate();
    let dateYmd = `${year}-${month}-${day}`;

    for (let { id: org_id } of orgs) {
      const all_pending_leaves = await get_all_pending_schedule_leaves(
        connection,
        org_id,
        dateYmd,
      );
      if (!all_pending_leaves) {
        continue;
      }

      for (let pl1 = 0; pl1 < all_pending_leaves.length; pl1++) {
        let total_leaves = 0;
        let deducted_leaves = 0;
        const {
          user_id,
          leaves_per_cycle,
          id: id1,
          leave_type_id: leave_type_id1,
          allocation_frequency,
          carry_forward,
        } = all_pending_leaves[pl1];
        total_leaves += leaves_per_cycle;
        if(carry_forward) deducted_leaves = leaves_per_cycle;
        // Insert Leave Into employee_leave_balance if not exists otherwise update the leave
        const is_present = await get_employee_leave_balance(
          connection,
          user_id,
          org_id,
          leave_type_id1,
        );
        if (!is_present) {
          const [res] = await connection.query(
            `INSERT INTO employee_leave_balance (user_id, org_id, leave_type_id, total_leaves, remaining_leaves, used_leaves)VALUES(?, ?, ?, ?, ?, ?)`,
            [
              user_id,
              org_id,
              leave_type_id1,
              leaves_per_cycle,
              leaves_per_cycle,
              0,
            ],
          );
          if (!res) {
            console.log(
              `Failed to insert leave into employee_leave_balance for user ${user_id} with leave type ${leave_type_id1}`,
            );
            continue;
          }
        } else {
          const [res] = await connection.query(
            `UPDATE employee_leave_balance SET (total_leaves, remaining_leaves, used_leaves) VALUES(?, ?, ?) WHERE user_id = ? AND org_id = ? AND leave_type_id = ?`,
            [
              leaves_per_cycle,
              leaves_per_cycle,
              0,
              user_id,
              org_id,
              leave_type_id1,
            ],
          );
          if (!res) {
            console.log(
              `Failed to update leave in employee_leave_balance for user ${user_id} with leave type ${leave_type_id1}`,
            );
            continue;
          }
        }
        const next_allocation_date = date_allocation_calculator(allocation_frequency, dateYmd);
        if (!next_allocation_date) {
          console.log(
            `Failed to calculate next allocation date for user ${user_id} with leave type ${leave_type_id1}`,
          );
          continue;
        }
        const is_updated = await update_leave_scheduler(connection, id1, leave_type_id1, org_id, next_allocation_date);
        if (!is_updated) {
          console.log(
            `Failed to update leave scheduler for id ${id1} and leave type ${leave_type_id1} and org ${org_id}`,
          );
          continue;
        }
        for (let pl2 = pl1 + 1; pl2 < all_pending_leaves.length; pl2++) {
          const { user_id: user_id2 } = all_pending_leaves[pl2];
          if (user_id === user_id2) {
            if (pl1 === pl2) continue;
            const {
              leaves_per_cycle: leaves_per_cycle2,
              id: id2,
              leave_type_id: leave_type_id2,
              allocation_frequency: allocation_frequency2,
              carry_forward: carry_forward2,
            } = all_pending_leaves[pl2];
            total_leaves += leaves_per_cycle2;
            if(carry_forward2) deducted_leaves += leaves_per_cycle2;
            // Insert Leave Into employee_leave_balance if not exists otherwise update the leave
            const is_present = await get_employee_leave_balance(
              connection,
              user_id2,
              org_id,
              leave_type_id2,
            );
            if (!is_present) {
              const [res] = await connection.query(
                `INSERT INTO employee_leave_balance (user_id, org_id, leave_type_id, total_leaves, remaining_leaves, used_leaves)VALUES(?, ?, ?, ?, ?, ?)`,
                [
                  user_id2,
                  org_id,
                  leave_type_id2,
                  leaves_per_cycle2,
                  leaves_per_cycle2,
                  0,
                ],
              );
              if (!res) {
                console.log(
                  `Failed to insert leave into employee_leave_balance for user ${user_id2} with leave type ${leave_type_id2}`,
                );
                continue;
              }
            } else {
              const [res] = await connection.query(
                `UPDATE employee_leave_balance SET (total_leaves, remaining_leaves, used_leaves) VALUES(?, ?, ?) WHERE user_id = ? AND org_id = ? AND leave_type_id = ?`,
                [
                  leaves_per_cycle2,
                  leaves_per_cycle2,
                  0,
                  user_id2,
                  org_id,
                  leave_type_id2,
                ],
              );
              if (!res) {
                console.log(
                  `Failed to update leave in employee_leave_balance for user ${user_id2} with leave type ${leave_type_id2}`,
                );
                continue;
              }
            }
            const next_allocation_date2 = date_allocation_calculator(allocation_frequency2, dateYmd);
            if (!next_allocation_date2) {
              console.log(
                `Failed to calculate next allocation date for user ${user_id2} with leave type ${leave_type_id2}`,
              );
              continue;
            }
            const is_updated2 = await update_leave_scheduler(connection, id2, leave_type_id2, org_id, next_allocation_date2);
            if (!is_updated2) {
              console.log(
                `Failed to update leave scheduler for id ${id2} and leave type ${leave_type_id2} and org ${org_id}`,
              );
              continue;
            }
          }
        
        }
        const remaining_leaves = total_leaves - deducted_leaves;
        // If leave_balance exists then update the leave_balance otherwise insert the leave_balance
        const [lv_balance] = await connection.query(`
          SELECT * FROM leave_balance WHERE user_id = ? AND org_id = ?
          `,[user_id, org_id]);
          if(lv_balance.length > 0) {
            await connection.query(`
              UPDATE leave_balance SET (user_id, org_id, year, month, total_leaves, used_leaves, remaining_leaves, last_leave_update)
              VALUES(?, ?, ?, ?, ?, ?, ?, ?)
              `,[user_id, org_id, year, month, total_leaves, used_leaves, remaining_leaves, new Date().toISOString().split("T")[0]]);
          } else {
            await connection.query(`
              INSERT INTO leave_balance (user_id, org_id, year, month, total_leaves, used_leaves, remaining_leaves, last_leave_update) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
              `,[user_id, org_id, year, month, total_leaves, used_leaves, remaining_leaves, new Date().toISOString().split("T")[0]]);
          }
      }
    }
    await connection.commit();
  } catch (error) {
    console.log(
      `Internal Server Error Inside cron schedule function: ${error}`,
    );
  }
});

async function update_leave_scheduler(connection, id, leave_type_id, org_id, dateYmd) {
  try {
    const [res] = await connection.query(
      `UPDATE leave_scheduler SET next_allocation_date = ? WHERE id = ? AND leave_type_id = ? AND org_id = ?`,
      [dateYmd, id, leave_type_id, org_id],
    );
    if (!res) {
      console.log(
        `Failed to update leave scheduler for id ${id} and leave type ${leave_type_id} and org ${org_id}`,
      );
      return false;
    }
    return true;
  }
  catch (error) {
    console.log(
      `Internal Server Error Inside update_leave_scheduler function: ${error}`,
    );
    return false;
  }
}
async function get_all_orgs_ids(connection) {
  try {
    const [orgs] = await connection.query(`SELECT id FROM apt_organizations`);
    return orgs;
  } catch (error) {
    console.log(
      `Internal Server Error Inside get_all_orgs_ids function: ${error}`,
    );
    return false;
  }
}

async function get_all_pending_schedule_leaves(connection, org_id, dateYmd) {
  try {
    const [leaves] = await connection.query(
      `SELECT * FROM leave_scheduler WHERE org_id = ? AND next_allocation_date = ?`,
      [org_id, dateYmd],
    );
    return leaves;
  } catch (error) {
    console.log(
      `Internal Server Error Inside get_all_leaves_of_org function: ${error}`,
    );
    return false;
  }
}

async function get_employee_leave_balance(
  connection,
  user_id,
  org_id,
  leave_type_id,
) {
  try {
    const [balance] = await connection.query(
      `SELECT * FROM employee_leave_balance WHERE user_id = ? AND org_id = ? AND leave_type_id = ?`,
      [user_id, org_id, leave_type_id],
    );
    return balance;
  } catch (error) {
    console.log(
      `Internal Server Error Inside get_employee_leave_balance function: ${error}`,
    );
    return false;
  }
}
const validFrequencies = ["monthly", "quarterly", "half_yearly", "yearly"];
function date_allocation_calculator(allocation_frequency, current_dateYmd) {
  if (!validFrequencies.includes(allocation_frequency)) {
    return false;
  }
  let new_date = new Date(current_dateYmd);
  switch (allocation_frequency) {
    case "monthly":
      new_date.setMonth(new_date.getMonth() + 1);
      return new_date.toISOString().split("T")[0];
    case "quarterly":
      new_date.setMonth(new_date.getMonth() + 3);
      return new_date.toISOString().split("T")[0];
    case "half_yearly":
      new_date.setMonth(new_date.getMonth() + 6);
      return new_date.toISOString().split("T")[0];
    case "yearly":
      new_date.setFullYear(new_date.getFullYear() + 1);
      return new_date.toISOString().split("T")[0];
  }
}
