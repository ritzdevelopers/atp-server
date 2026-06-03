const activity_tracker = async (
    connection,
    performed_by,
    performed_by_name,
    activity_overview,
    org_id,
    activity_type
  ) => {
    const [activityResult] = await connection.query(
      `
      INSERT INTO management_activity_log
      (
        org_id,
        activity_type,
        activity_overview,
        performed_by,
        performed_by_name
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        org_id,
        activity_type,
        activity_overview,
        performed_by,
        performed_by_name,
      ]
    );
  
    if (!activityResult.affectedRows) {
      throw new Error("Failed to save management activity log");
    }
  
    return true;
  };

export default activity_tracker;