import activity_tracker from "../../../helper/activity_tracking.js";
import Chat from "../../../models/chat.schema.js";
import { pool } from "../../../db/connect.js";
import {
  getEmployeeName,
  isEmployeeExists,
} from "../../../helper/employee_checker.js";
import errorHandling from "../../../utils/error.handling.js";
import Message from "../../../models/msg.schema.js";
import { isValidObjectId } from "mongoose";

function normalizeUserRow(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.user_name,
    email: user.user_email,
    profile_picture: user.user_image,
  };
}

async function fetchUsersMap(connection, userIds) {
  const uniqueIds = [
    ...new Set(
      userIds
        .filter((id) => id != null && id !== "")
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id)),
    ),
  ];

  if (uniqueIds.length === 0) return new Map();

  const placeholders = uniqueIds.map(() => "?").join(", ");
  const [rows] = await connection.query(
    `SELECT id, user_name, user_email, user_image FROM apt_users WHERE id IN (${placeholders})`,
    uniqueIds,
  );

  const map = new Map();
  for (const row of rows) {
    map.set(Number(row.id), normalizeUserRow(row));
  }
  return map;
}

function normalizeReplyTo(replyToDoc, usersMap) {
  if (!replyToDoc) return null;

  if (typeof replyToDoc === "object" && replyToDoc._id) {
    return {
      _id: replyToDoc._id,
      content: replyToDoc.content ?? "",
      sender:
        usersMap.get(Number(replyToDoc.sender)) ?? { id: replyToDoc.sender },
      created_at: replyToDoc.createdAt ?? replyToDoc.created_at ?? null,
    };
  }

  return { _id: replyToDoc };
}

function parseGroupAdminIds(value) {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : [value];
  return [
    ...new Set(
      raw
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id) && id > 0),
    ),
  ];
}

function getGroupAdminIds(group) {
  const fromArray = parseGroupAdminIds(group?.group_admins);
  if (fromArray.length > 0) return fromArray;

  if (group?.group_admin != null) {
    return parseGroupAdminIds(group.group_admin);
  }

  return [];
}

function isGroupAdmin(group, userId) {
  return getGroupAdminIds(group).includes(Number(userId));
}

function parseMemberIds(value) {
  return parseGroupAdminIds(value);
}

function getParticipantIds(group) {
  return [
    ...new Set(
      (group?.participants ?? [])
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id) && id > 0),
    ),
  ];
}

function isParticipant(group, userId) {
  return getParticipantIds(group).includes(Number(userId));
}

async function logGroupActivity(
  connection,
  actionUserId,
  companyId,
  overview,
  activityType,
) {
  const user = await getEmployeeName(connection, actionUserId, companyId);
  if (!user.success) {
    return { ok: false, status: 404, message: "User Not Found" };
  }

  const activityResult = await activity_tracker(
    connection,
    actionUserId,
    user.name,
    overview,
    companyId,
    activityType,
  );

  if (!activityResult) {
    return {
      ok: false,
      status: 400,
      message: "Activity Log Creation Failed",
    };
  }

  return { ok: true, performerName: user.name };
}

export const create_new_group = async (req, res) => {
  let connection;

  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: action_user_id } = req.user;
    const { org_id: company_id } = req;

    const {
      group_name,
      group_image,
      group_description,
      group_admins,
      group_admin,
      participants,
    } = req.body;

    const groupAdminIds = parseGroupAdminIds(group_admins ?? group_admin);

    // Validation
    if (
      !group_name ||
      groupAdminIds.length === 0 ||
      !company_id ||
      !action_user_id ||
      !Array.isArray(participants) ||
      participants.length === 0
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "All Fields Are Required",
        error: "All Fields Are Required",
      });
    }

    const participantIds = [
      ...new Set(participants.map((id) => Number(id)).filter((id) => !Number.isNaN(id))),
    ];

    if (participantIds.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Valid Participants Are Required",
        error: "Valid Participants Are Required",
      });
    }

    for (const adminId of groupAdminIds) {
      if (!participantIds.includes(adminId)) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Every Group Admin Must Be A Group Participant",
          error: "Every Group Admin Must Be A Group Participant",
        });
      }
    }

    // Check Employee Exists
    if (!(await isEmployeeExists(connection, action_user_id, company_id))) {
      await connection.rollback();

      return errorHandling(
        connection,
        res,
        false,
        "User Not Found",
        new Error("User Not Found"),
        404,
      );
    }

    // Duplicate Group Check
    const existingGroup = await Chat.findOne({
      company_id,
      group_name: {
        $regex: `^${group_name.trim()}$`,
        $options: "i",
      },
    });

    if (existingGroup) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message: "Group With This Name Already Exists",
        error: "Duplicate Group Name",
      });
    }

    // Check If Participants Are Exists
    for (const participant of participantIds) {
      if (!(await isEmployeeExists(connection, participant, company_id))) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Participant Not Found",
          error: "Participant Not Found",
        });
      }
    }

    for (const adminId of groupAdminIds) {
      if (!(await isEmployeeExists(connection, adminId, company_id))) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Group Admin Not Found",
          error: "Group Admin Not Found",
        });
      }
    }

    // Create Group
    const group = await Chat.create({
      group_name: group_name.trim(),
      group_image: group_image || "",
      group_description: group_description || "",
      group_admins: groupAdminIds,
      participants: participantIds,
      company_id,
      chat_type: "group",
    });

    if (!group) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Group Creation Failed",
        error: "Group Creation Failed",
      });
    }

    // Get User Name
    const user = await getEmployeeName(
      connection,
      action_user_id,
      company_id,
    );

    if (!user.success) {
      await Chat.findByIdAndDelete(group._id);

      await connection.rollback();

      return errorHandling(
        connection,
        res,
        false,
        "User Not Found",
        new Error("User Not Found"),
        404,
      );
    }

    const performed_by_name = user.name;

    // Activity Log
    const result = await activity_tracker(
      connection,
      action_user_id,
      performed_by_name,
      `Group Created: ${group_name}`,
      company_id,
      "GROUP_CREATED_IN_CHAT_SYSTEM",
    );

    if (!result) {
      await Chat.findByIdAndDelete(group._id);

      await connection.rollback();

      return errorHandling(
        connection,
        res,
        false,
        "Activity Log Creation Failed",
        new Error("Activity Log Creation Failed"),
        400,
      );
    }

    await connection.commit();

    return res.status(201).json({
      success: true,
      message: "Group Created Successfully",
      data: group,
    });
  } catch (error) {
    console.error(error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const get_all_groups_where_i_am_participant = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: action_user_id } = req.user;
    const { org_id: company_id } = req;

    if (!(await isEmployeeExists(connection, action_user_id, company_id))) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "User Not Found",
        new Error("User Not Found"),
        404,
      );
    }

    // Fetch Groups Where I Am Participant
    const groups = await Chat.find({
      company_id,
      chat_type: "group",
      is_group_active: true,
      participants: {
        $in: [action_user_id],
      },
    });
    if (!groups || groups.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "No Groups Found",
        error: "No Groups Found",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Groups Found Successfully",
      data: groups,
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "Internal Server Error",
        new Error("Internal Server Error"),
        500,
      );
    }
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const get_my_group_chat = async (req, res) => {
  let connection;
  try {
    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    const { user_id: action_user_id } = req.user;
    const { org_id: company_id } = req;

    if (!(await isEmployeeExists(connection, action_user_id, company_id))) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "User Not Found",
        new Error("User Not Found"),
        404,
      );
    }

    // Fetch My Single Group Chat
    const group_chat = await Chat.findOne({
      company_id,
      chat_type: "group",
      is_group_active: true,
      participants: {
        $in: [action_user_id],
      },
    });
    if (!group_chat) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Group Chat Not Found",
        error: "Group Chat Not Found",
      });
    }
    const group_members = group_chat.participants?.length
        ? group_chat.participants
        : [action_user_id];

    const messages = await Message.find({
      company_id,
      chat_id: group_chat._id,
      is_deleted: false,
    })
      .populate("reply_to")
      .sort({ createdAt: -1 })
      .limit(50);

    const group_admin_ids = getGroupAdminIds(group_chat);

    const relatedUserIds = new Set([
      ...group_members,
      ...group_admin_ids,
      action_user_id,
    ]);

      for (const message of messages) {
      relatedUserIds.add(message.sender);
      for (const userId of message.delivered_to ?? []) {
        relatedUserIds.add(userId);
      }
      for (const userId of message.seen_by ?? []) {
        relatedUserIds.add(userId);
      }
      if (message.reply_to?.sender) {
        relatedUserIds.add(message.reply_to.sender);
      }
    }

    const usersMap = await fetchUsersMap(connection, [...relatedUserIds]);

    const normalized_admins = group_admin_ids
      .map((adminId) => usersMap.get(adminId))
      .filter(Boolean);

    if (normalized_admins.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Group Admins Not Found",
        error: "Group Admins Not Found",
      });
    }

    const group_members_info = group_members
      .map((memberId) => usersMap.get(Number(memberId)))
      .filter(Boolean);

    const last_50_messages = [];
    for (const message of messages) {
      const sender = usersMap.get(Number(message.sender));
      if (!sender) {
          await connection.rollback();
          return res.status(404).json({
            success: false,
            message: "Sender Not Found",
            error: "Sender Not Found",
          });
        }

      const delivered_to = (message.delivered_to ?? [])
        .map((userId) => usersMap.get(Number(userId)))
        .filter(Boolean);

      const seen_by = (message.seen_by ?? [])
        .map((userId) => usersMap.get(Number(userId)))
        .filter(Boolean);

        last_50_messages.push({
        _id: message._id,
          sender,
        content: message.content ?? "",
        attachments: message.attachments ?? [],
        reply_to: normalizeReplyTo(message.reply_to, usersMap),
        delivered_to,
        seen_by,
        is_edited: Boolean(message.is_edited),
        edited_at: message.edited_at ?? null,
        created_at: message.createdAt ?? message.created_at ?? null,
        send_by_me: Number(message.sender) === Number(action_user_id),
      });
    }

    // Fetched newest-first; return oldest-first for chat UI.
    last_50_messages.reverse();
    let normalized_group_chat = {
      _id: group_chat._id,
      group_name: group_chat.group_name,
      group_image: group_chat.group_image,
      group_description: group_chat.group_description,
      group_admins: normalized_admins,
      group_members: group_members_info,
      company_id: group_chat.company_id,
      created_at: group_chat.createdAt ?? group_chat.created_at ?? null,
      last_50_messages: last_50_messages,
    };
    await connection.commit();
    return res.status(200).json({
      success: true,
      message: "Group Chat Found Successfully",
      data: normalized_group_chat,
    });
  } catch (error) {
    console.error(error);
    if (connection) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "Internal Server Error",
        new Error("Internal Server Error"),
        500,
      );
    }
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const edit_group_information = async (req, res) => {
  let connection;

  try {
    const { user_id: action_user_id } = req.user;
    const { org_id: company_id } = req;
    const { group_id } = req.params;
    const { group_name, group_image, group_description } = req.body;

    if (!group_id || !company_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "Group Id Is Required",
        error: "Group Id Is Required",
      });
    }

    if (!isValidObjectId(group_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Group Id",
        error: "Invalid Group Id",
      });
    }

    const hasGroupName = Object.prototype.hasOwnProperty.call(
      req.body,
      "group_name",
    );
    const hasGroupImage = Object.prototype.hasOwnProperty.call(
      req.body,
      "group_image",
    );
    const hasGroupDescription = Object.prototype.hasOwnProperty.call(
      req.body,
      "group_description",
    );

    if (!hasGroupName && !hasGroupImage && !hasGroupDescription) {
      return res.status(400).json({
        success: false,
        message: "At Least One Field Is Required To Update",
        error: "At Least One Field Is Required To Update",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, company_id))) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "User Not Found",
        new Error("User Not Found"),
        404,
      );
    }

    const group = await Chat.findOne({
      _id: group_id,
      company_id,
      chat_type: "group",
      is_group_active: true,
    });

    if (!group) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Group Not Found",
        error: "Group Not Found",
      });
    }

    if (!isGroupAdmin(group, action_user_id)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Only Group Admin Can Edit Group Information",
        error: "Only Group Admin Can Edit Group Information",
      });
    }

    const updatePayload = {};

    if (hasGroupName) {
      const trimmedName = String(group_name ?? "").trim();
      if (!trimmedName) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: "Group Name Cannot Be Empty",
          error: "Group Name Cannot Be Empty",
        });
      }

      const escapedName = trimmedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const duplicateGroup = await Chat.findOne({
        _id: { $ne: group_id },
        company_id,
        chat_type: "group",
        group_name: {
          $regex: `^${escapedName}$`,
          $options: "i",
        },
      });

      if (duplicateGroup) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          message: "Group With This Name Already Exists",
          error: "Duplicate Group Name",
        });
      }

      updatePayload.group_name = trimmedName;
    }

    if (hasGroupImage) {
      updatePayload.group_image = group_image || "";
    }

    if (hasGroupDescription) {
      updatePayload.group_description = group_description || "";
    }

    const updatedGroup = await Chat.findByIdAndUpdate(
      group_id,
      { $set: updatePayload },
      { new: true, runValidators: true },
    );

    if (!updatedGroup) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Group Update Failed",
        error: "Group Update Failed",
      });
    }

    const user = await getEmployeeName(
      connection,
      action_user_id,
      company_id,
    );

    if (!user.success) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "User Not Found",
        new Error("User Not Found"),
        404,
      );
    }

    const updatedFields = Object.keys(updatePayload).join(", ");
    const activityResult = await activity_tracker(
      connection,
      action_user_id,
      user.name,
      `Group information updated (${updatedFields}): ${updatedGroup.group_name}`,
      company_id,
      "GROUP_UPDATED_IN_CHAT_SYSTEM",
    );

    if (!activityResult) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "Activity Log Creation Failed",
        new Error("Activity Log Creation Failed"),
        400,
      );
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Group Information Updated Successfully",
      data: updatedGroup,
    });
  } catch (error) {
    console.error(error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const add_new_group_admin = async (req, res) => {
  let connection;

  try {
    const { user_id: action_user_id } = req.user;
    const { org_id: company_id } = req;
    const { group_id } = req.params;
    const { new_group_admin, group_admin } = req.body;
    const newAdminIds = parseGroupAdminIds(new_group_admin ?? group_admin);

    if (!group_id || !company_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "Group Id Is Required",
        error: "Group Id Is Required",
      });
    }

    if (!isValidObjectId(group_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Group Id",
        error: "Invalid Group Id",
      });
    }

    if (newAdminIds.length !== 1) {
      return res.status(400).json({
        success: false,
        message: "A Valid New Group Admin Id Is Required",
        error: "A Valid New Group Admin Id Is Required",
      });
    }

    const newAdminId = newAdminIds[0];

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, company_id))) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "User Not Found",
        new Error("User Not Found"),
        404,
      );
    }

    if (!(await isEmployeeExists(connection, newAdminId, company_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "New Group Admin Not Found In Organization",
        error: "New Group Admin Not Found In Organization",
      });
    }

    const group = await Chat.findOne({
      _id: group_id,
      company_id,
      chat_type: "group",
      is_group_active: true,
    });

    if (!group) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Group Not Found",
        error: "Group Not Found",
      });
    }

    if (!isGroupAdmin(group, action_user_id)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Only Group Admin Can Add New Group Admin",
        error: "Only Group Admin Can Add New Group Admin",
      });
    }

    if (!isParticipant(group, newAdminId)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "New Group Admin Must Be A Group Participant",
        error: "New Group Admin Must Be A Group Participant",
      });
    }

    if (isGroupAdmin(group, newAdminId)) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "User Is Already A Group Admin",
        error: "User Is Already A Group Admin",
      });
    }

    const updatedGroup = await Chat.findByIdAndUpdate(
      group_id,
      { $addToSet: { group_admins: newAdminId } },
      { new: true, runValidators: true },
    );

    if (!updatedGroup) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed To Add Group Admin",
        error: "Failed To Add Group Admin",
      });
    }

    const activity = await logGroupActivity(
      connection,
      action_user_id,
      company_id,
      `Group admin added (user_id: ${newAdminId}) in group: ${updatedGroup.group_name}`,
      "GROUP_ADMIN_ADDED_IN_CHAT_SYSTEM",
    );

    if (!activity.ok) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        activity.message,
        new Error(activity.message),
        activity.status,
      );
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Group Admin Added Successfully",
      data: updatedGroup,
    });
  } catch (error) {
    console.error(error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const remove_group_admin = async (req, res) => {
  let connection;

  try {
    const { user_id: action_user_id } = req.user;
    const { org_id: company_id } = req;
    const { group_id } = req.params;
    const { group_admin, admin_id } = req.body;
    const adminIdsToRemove = parseGroupAdminIds(group_admin ?? admin_id);

    if (!group_id || !company_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "Group Id Is Required",
        error: "Group Id Is Required",
      });
    }

    if (!isValidObjectId(group_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Group Id",
        error: "Invalid Group Id",
      });
    }

    if (adminIdsToRemove.length !== 1) {
      return res.status(400).json({
        success: false,
        message: "A Valid Group Admin Id Is Required",
        error: "A Valid Group Admin Id Is Required",
      });
    }

    const adminIdToRemove = adminIdsToRemove[0];

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, company_id))) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "User Not Found",
        new Error("User Not Found"),
        404,
      );
    }

    if (!(await isEmployeeExists(connection, adminIdToRemove, company_id))) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Group Admin Not Found In Organization",
        error: "Group Admin Not Found In Organization",
      });
    }

    const group = await Chat.findOne({
      _id: group_id,
      company_id,
      chat_type: "group",
      is_group_active: true,
    });

    if (!group) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Group Not Found",
        error: "Group Not Found",
      });
    }

    if (!isGroupAdmin(group, action_user_id)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Only Group Admin Can Remove Group Admin",
        error: "Only Group Admin Can Remove Group Admin",
      });
    }

    const currentAdminIds = getGroupAdminIds(group);

    if (!currentAdminIds.includes(adminIdToRemove)) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "User Is Not A Group Admin",
        error: "User Is Not A Group Admin",
      });
    }

    if (currentAdminIds.length <= 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Group Must Have At Least One Admin",
        error: "Group Must Have At Least One Admin",
      });
    }

    const updatedGroup = await Chat.findByIdAndUpdate(
      group_id,
      { $pull: { group_admins: adminIdToRemove } },
      { new: true, runValidators: true },
    );

    if (!updatedGroup) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed To Remove Group Admin",
        error: "Failed To Remove Group Admin",
      });
    }

    const activity = await logGroupActivity(
      connection,
      action_user_id,
      company_id,
      `Group admin removed (user_id: ${adminIdToRemove}) from group: ${updatedGroup.group_name}`,
      "GROUP_ADMIN_REMOVED_IN_CHAT_SYSTEM",
    );

    if (!activity.ok) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        activity.message,
        new Error(activity.message),
        activity.status,
      );
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Group Admin Removed Successfully",
      data: updatedGroup,
    });
  } catch (error) {
    console.error(error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const add_new_members_to_group = async (req, res) => {
  let connection;

  try {
    const { user_id: action_user_id } = req.user;
    const { org_id: company_id } = req;
    const { group_id } = req.params;
    const { participants, member_ids, members } = req.body;
    const memberIds = parseMemberIds(participants ?? member_ids ?? members);

    if (!group_id || !company_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "Group Id Is Required",
        error: "Group Id Is Required",
      });
    }

    if (!isValidObjectId(group_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Group Id",
        error: "Invalid Group Id",
      });
    }

    if (memberIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At Least One Valid Member Id Is Required",
        error: "At Least One Valid Member Id Is Required",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, company_id))) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "User Not Found",
        new Error("User Not Found"),
        404,
      );
    }

    for (const memberId of memberIds) {
      if (!(await isEmployeeExists(connection, memberId, company_id))) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: `Member Not Found In Organization (user_id: ${memberId})`,
          error: "Member Not Found In Organization",
        });
      }
    }

    const group = await Chat.findOne({
      _id: group_id,
      company_id,
      chat_type: "group",
      is_group_active: true,
    });

    if (!group) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Group Not Found",
        error: "Group Not Found",
      });
    }

    if (!isGroupAdmin(group, action_user_id)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Only Group Admin Can Add Members",
        error: "Only Group Admin Can Add Members",
      });
    }

    const existingParticipantIds = getParticipantIds(group);
    const newMemberIds = memberIds.filter(
      (memberId) => !existingParticipantIds.includes(memberId),
    );

    if (newMemberIds.length === 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "All Provided Members Are Already In The Group",
        error: "All Provided Members Are Already In The Group",
      });
    }

    const updatedGroup = await Chat.findByIdAndUpdate(
      group_id,
      { $addToSet: { participants: { $each: newMemberIds } } },
      { new: true, runValidators: true },
    );

    if (!updatedGroup) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed To Add Members To Group",
        error: "Failed To Add Members To Group",
      });
    }

    const activity = await logGroupActivity(
      connection,
      action_user_id,
      company_id,
      `Members added (user_ids: ${newMemberIds.join(", ")}) to group: ${updatedGroup.group_name}`,
      "GROUP_MEMBERS_ADDED_IN_CHAT_SYSTEM",
    );

    if (!activity.ok) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        activity.message,
        new Error(activity.message),
        activity.status,
      );
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Members Added To Group Successfully",
      data: {
        group: updatedGroup,
        added_member_ids: newMemberIds,
        skipped_member_ids: memberIds.filter((id) =>
          existingParticipantIds.includes(id),
        ),
      },
    });
  } catch (error) {
    console.error(error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const remove_members_from_group = async (req, res) => {
  let connection;

  try {
    const { user_id: action_user_id } = req.user;
    const { org_id: company_id } = req;
    const { group_id } = req.params;
    const { participants, member_ids, members } = req.body;
    const memberIds = parseMemberIds(participants ?? member_ids ?? members);

    if (!group_id || !company_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "Group Id Is Required",
        error: "Group Id Is Required",
      });
    }

    if (!isValidObjectId(group_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Group Id",
        error: "Invalid Group Id",
      });
    }

    if (memberIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At Least One Valid Member Id Is Required",
        error: "At Least One Valid Member Id Is Required",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, company_id))) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "User Not Found",
        new Error("User Not Found"),
        404,
      );
    }

    for (const memberId of memberIds) {
      if (!(await isEmployeeExists(connection, memberId, company_id))) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: `Member Not Found In Organization (user_id: ${memberId})`,
          error: "Member Not Found In Organization",
        });
      }
    }

    const group = await Chat.findOne({
      _id: group_id,
      company_id,
      chat_type: "group",
      is_group_active: true,
    });

    if (!group) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Group Not Found",
        error: "Group Not Found",
      });
    }

    if (!isGroupAdmin(group, action_user_id)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Only Group Admin Can Remove Members",
        error: "Only Group Admin Can Remove Members",
      });
    }

    const currentParticipantIds = getParticipantIds(group);

    for (const memberId of memberIds) {
      if (!currentParticipantIds.includes(memberId)) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: `User Is Not A Group Member (user_id: ${memberId})`,
          error: "User Is Not A Group Member",
        });
      }

      if (isGroupAdmin(group, memberId)) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Remove Group Admin Role Before Removing Member (user_id: ${memberId})`,
          error: "Remove Group Admin Role Before Removing Member",
        });
      }
    }

    const remainingParticipantIds = currentParticipantIds.filter(
      (participantId) => !memberIds.includes(participantId),
    );

    if (remainingParticipantIds.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Group Must Have At Least One Member",
        error: "Group Must Have At Least One Member",
      });
    }

    const updatedGroup = await Chat.findByIdAndUpdate(
      group_id,
      { $pullAll: { participants: memberIds } },
      { new: true, runValidators: true },
    );

    if (!updatedGroup) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed To Remove Members From Group",
        error: "Failed To Remove Members From Group",
      });
    }

    const activity = await logGroupActivity(
      connection,
      action_user_id,
      company_id,
      `Members removed (user_ids: ${memberIds.join(", ")}) from group: ${updatedGroup.group_name}`,
      "GROUP_MEMBERS_REMOVED_IN_CHAT_SYSTEM",
    );

    if (!activity.ok) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        activity.message,
        new Error(activity.message),
        activity.status,
      );
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Members Removed From Group Successfully",
      data: {
        group: updatedGroup,
        removed_member_ids: memberIds,
      },
    });
  } catch (error) {
    console.error(error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

export const inactive_group = async (req, res) => {
  let connection;

  try {
    const { user_id: action_user_id } = req.user;
    const { org_id: company_id } = req;
    const { group_id } = req.params;
    const { is_group_active } = req.body;

    if (!group_id || !company_id || !action_user_id) {
      return res.status(400).json({
        success: false,
        message: "Group Id Is Required",
        error: "Group Id Is Required",
      });
    }

    if (!isValidObjectId(group_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Group Id",
        error: "Invalid Group Id",
      });
    }

    if (typeof is_group_active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "is_group_active Must Be A Boolean (true Or false)",
        error: "is_group_active Must Be A Boolean",
      });
    }

    connection = await pool.promise().getConnection();
    await connection.beginTransaction();

    if (!(await isEmployeeExists(connection, action_user_id, company_id))) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        "User Not Found",
        new Error("User Not Found"),
        404,
      );
    }

    const group = await Chat.findOne({
      _id: group_id,
      company_id,
      chat_type: "group",
    });

    if (!group) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Group Not Found",
        error: "Group Not Found",
      });
    }

    if (!isGroupAdmin(group, action_user_id)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Only Group Admin Can Change Group Active Status",
        error: "Only Group Admin Can Change Group Active Status",
      });
    }

    if (group.is_group_active === is_group_active) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: is_group_active
          ? "Group Is Already Active"
          : "Group Is Already Inactive",
        error: "Group Active Status Unchanged",
      });
    }

    const updatedGroup = await Chat.findByIdAndUpdate(
      group_id,
      { $set: { is_group_active } },
      { new: true, runValidators: true },
    );

    if (!updatedGroup) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Failed To Update Group Active Status",
        error: "Failed To Update Group Active Status",
      });
    }

    const activityType = is_group_active
      ? "GROUP_ACTIVATED_IN_CHAT_SYSTEM"
      : "GROUP_DEACTIVATED_IN_CHAT_SYSTEM";
    const activityOverview = is_group_active
      ? `Group activated: ${updatedGroup.group_name}`
      : `Group deactivated: ${updatedGroup.group_name}`;

    const activity = await logGroupActivity(
      connection,
      action_user_id,
      company_id,
      activityOverview,
      activityType,
    );

    if (!activity.ok) {
      await connection.rollback();
      return errorHandling(
        connection,
        res,
        false,
        activity.message,
        new Error(activity.message),
        activity.status,
      );
    }

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: is_group_active
        ? "Group Activated Successfully"
        : "Group Deactivated Successfully",
      data: updatedGroup,
    });
  } catch (error) {
    console.error(error);

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Rollback Error:", rollbackError.message);
      }
    }

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};
export const get_org_users_for_chat = async (req, res) => {
  try {
    const { org_id: company_id } = req;

    if (!company_id) {
      return res.status(400).json({
        success: false,
        message: "Organization is required",
      });
    }

    const [rows] = await pool.promise().query(
      `
      SELECT
        apt_users.id AS user_id,
        apt_users.user_name,
        apt_users.user_email,
        apt_users.user_image
      FROM apt_org_members
      INNER JOIN apt_users ON apt_users.id = apt_org_members.user_id
      WHERE apt_org_members.org_id = ?
        AND apt_org_members.is_active = 1
      ORDER BY apt_users.user_name ASC
      `,
      [company_id],
    );

    return res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: (rows ?? []).map((row) => ({
        user_id: row.user_id,
        user_name: row.user_name,
        user_email: row.user_email,
        user_profile: row.user_image || null,
      })),
    });
  } catch (error) {
    console.error("get_org_users_for_chat:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

