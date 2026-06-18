import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const user_active_status_schema = new Schema(
  {
    user_id: {
      type: Number,
      required: true,
    },
    org_id: {
      type: Number,
      required: true,
    },
    last_active_time: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

user_active_status_schema.index({ user_id: 1, org_id: 1 }, { unique: true });

const UserActiveStatus =
  models.UserActiveStatus ||
  model("UserActiveStatus", user_active_status_schema);

export default UserActiveStatus;
