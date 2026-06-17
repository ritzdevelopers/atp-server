import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "dns";

dotenv.config();

dns.setServers([
  "8.8.8.8",
  "8.8.4.4"
]);

async function connectMongo() {
  try {
    console.log("Connecting Mongo...");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Mongo Connected ✅");
  } catch (error) {
    console.error("Mongo Failed ❌", error);
  }
}

export default connectMongo;