const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PINATA_API_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';

async function pinFormDataToIPFS(formData) {
  const response = await axios.post(PINATA_API_URL, formData, {
    headers: {
      ...formData.getHeaders(),
      Authorization: `Bearer ${process.env.PINATA_JWT}`
    }
  });

  return response.data.IpfsHash;
}

async function uploadBufferToIPFS(buffer, fileName, mimeType) {
  try {
    const formData = new FormData();
    formData.append('file', buffer, {
      filename: fileName,
      contentType: mimeType || 'application/octet-stream'
    });

    const cid = await pinFormDataToIPFS(formData);
    console.log(`✅ IPFS buffer upload successful: ${cid}`);
    return cid;
  } catch (error) {
    console.error('❌ IPFS buffer upload failed:', error.message);
    throw new Error(`IPFS buffer upload failed: ${error.message}`);
  }
}

async function uploadFilePathToIPFS(filePath, fileName) {
  try {
    const fileStream = fs.createReadStream(filePath);
    const formData = new FormData();
    formData.append('file', fileStream, fileName || path.basename(filePath));

    const cid = await pinFormDataToIPFS(formData);
    console.log(`✅ IPFS file upload successful: ${cid}`);
    return cid;
  } catch (error) {
    console.error('❌ IPFS file upload failed:', error.message);
    throw new Error(`IPFS file upload failed: ${error.message}`);
  }
}

async function uploadJSONToIPFS(jsonData, fileName) {
  try {
    console.log(`📤 Uploading to IPFS: ${fileName}`);
    
    // Create temporary file
    const tempPath = path.join(os.tmpdir(), `${Date.now()}-${fileName}.json`);
    fs.writeFileSync(tempPath, JSON.stringify(jsonData, null, 2));

    const fileStream = fs.createReadStream(tempPath);
    const formData = new FormData();
    formData.append('file', fileStream, `${fileName}.json`);

    const cid = await pinFormDataToIPFS(formData);

    // Clean up temp file
    fs.unlinkSync(tempPath);

    console.log(`✅ IPFS Upload successful: ${cid}`);
    return cid;
  } catch (error) {
    console.error('❌ IPFS upload failed:', error.message);
    throw new Error(`IPFS upload failed: ${error.message}`);
  }
}

module.exports = {
  uploadJSONToIPFS,
  uploadBufferToIPFS,
  uploadFilePathToIPFS
};
