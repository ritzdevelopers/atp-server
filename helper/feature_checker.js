export const is_organization_contains_this_feature = async (
  connection,
  org_id,
  feature_id,
) => {
  try {
    const [feature_result] = await connection.query(
      `
        SELECT * FROM apt_org_feature_access WHERE org_id = ? AND feature_id = ?
        `,
      [org_id, feature_id],
    );
    if (feature_result.length === 0) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
};

export const is_organization_contains_this_sub_feature = async (
  connection,
  org_id,
  sub_feature_id,
  parent_feature_id,
) => {
  try {
    const [sub_feature_result] = await connection.query(
      `
            SELECT * FROM apt_org_sub_features_access WHERE org_id = ? AND sub_feature_id = ? AND parent_feature_id = ?
            `,
      [org_id, sub_feature_id, parent_feature_id],
    );
    if (sub_feature_result.length === 0) {
      return false;
    }
    return true;
  } catch (error) {
    return false;
  }
};
