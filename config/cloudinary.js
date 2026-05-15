import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});


const uploadToCloudinary = (
  fileBuffer,
  folder = "mern_uploads",
  resourceType = "auto"
) => {

  return new Promise((resolve, reject) => {

    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
      },

      (error, result) => {

        if (error) {
          return reject(error);
        }

        resolve(result);
      }
    );

    streamifier
      .createReadStream(fileBuffer)
      .pipe(stream);

  });
};

/**
 * Remove an asset from Cloudinary (ignore empty public_id).
 * @param {string} publicId
 * @param {string} [resourceType] — e.g. "image", "raw" (PDF), from upload result
 */
export const destroyFromCloudinary = (publicId, resourceType = "image") => {
  if (!publicId || String(publicId).trim() === "") {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    cloudinary.uploader.destroy(
      String(publicId).trim(),
      { resource_type: resourceType || "image" },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );
  });
};

export default uploadToCloudinary;