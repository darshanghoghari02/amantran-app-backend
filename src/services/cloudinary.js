import { v2 as cloudinary } from 'cloudinary';

// ─── Configure Cloudinary ────────────────────────────────────────────
// Priority 1: CLOUDINARY_URL env var (cloudinary://API_KEY:API_SECRET@CLOUD_NAME)
// Priority 2: Individual env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// The cloudinary SDK auto-reads CLOUDINARY_URL if set, but we also support individual vars.

if (process.env.CLOUDINARY_URL) {
  const match = process.env.CLOUDINARY_URL.match(/cloudinary:\/\/([^:]+):([^@]+)@(.+)/);
  if (match) {
    cloudinary.config({
      api_key: match[1],
      api_secret: match[2],
      cloud_name: match[3],
      secure: true
    });
  } else {
    cloudinary.config({ secure: true });
  }
} else {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

/**
 * Check if Cloudinary is configured and ready to use.
 */
export function isCloudinaryConfigured() {
  return false;
}

/**
 * Upload a local file to Cloudinary.
 * @param {string} localFilePath - Absolute path to the file on disk
 * @param {string} folder - Cloudinary folder path (e.g., "amantran/images/wedding/royal_wedding")
 * @param {string} [publicId] - Optional custom public_id for the asset
 * @returns {Promise<{url: string, publicId: string, secureUrl: string}>}
 */
export async function uploadToCloudinary(localFilePath, folder, publicId) {
  const options = {
    folder: folder || 'amantran/assets',
    resource_type: 'auto',
    overwrite: true,
    quality: 'auto',
    fetch_format: 'auto'
  };

  if (publicId) {
    options.public_id = publicId;
  }

  const result = await cloudinary.uploader.upload(localFilePath, options);

  return {
    url: result.secure_url,
    secureUrl: result.secure_url,
    publicId: result.public_id
  };
}

/**
 * Delete a file from Cloudinary by its public_id.
 * @param {string} publicId - The Cloudinary public_id
 * @returns {Promise<boolean>}
 */
export async function deleteFromCloudinary(publicId) {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result.result === 'ok';
  } catch (err) {
    console.warn(`⚠️ Cloudinary delete failed for ${publicId}:`, err.message);
    return false;
  }
}

/**
 * Extract the public_id from a Cloudinary URL.
 * e.g. "https://res.cloudinary.com/xxx/image/upload/v123/amantran/assets/wedding/img.jpg"
 *   → "amantran/assets/wedding/img"
 * @param {string} url - Full Cloudinary URL
 * @returns {string|null}
 */
export function extractPublicId(url) {
  if (!url || !url.includes('res.cloudinary.com')) return null;
  try {
    // Pattern: .../upload/v<version>/<public_id>.<ext>
    // Or:      .../upload/<public_id>.<ext>
    const uploadIdx = url.indexOf('/upload/');
    if (uploadIdx === -1) return null;
    
    let afterUpload = url.substring(uploadIdx + '/upload/'.length);
    
    // Remove query parameters or hash fragments
    const questionMarkIdx = afterUpload.indexOf('?');
    if (questionMarkIdx !== -1) {
      afterUpload = afterUpload.substring(0, questionMarkIdx);
    }
    const hashIdx = afterUpload.indexOf('#');
    if (hashIdx !== -1) {
      afterUpload = afterUpload.substring(0, hashIdx);
    }

    // Remove version prefix if present (e.g., "v1234567890/")
    if (/^v\d+\//.test(afterUpload)) {
      afterUpload = afterUpload.replace(/^v\d+\//, '');
    }
    
    // Remove file extension
    const lastDot = afterUpload.lastIndexOf('.');
    if (lastDot !== -1) {
      afterUpload = afterUpload.substring(0, lastDot);
    }
    
    return afterUpload;
  } catch {
    return null;
  }
}

export { cloudinary };
