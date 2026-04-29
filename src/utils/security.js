const CryptoJS = require('crypto-js');

/**
 * Derives a deterministic shared key for a conversation based on its ID.
 */
const deriveKey = (conversationId) => {
    const salt = "KrushiMitra_SECURE_2026_SALT_";
    return CryptoJS.SHA256(salt + conversationId.toString()).toString();
};

/**
 * Encrypts a message string using AES-256
 */
exports.encryptMessage = (content, conversationId) => {
    if (!content || !conversationId) return content;
    try {
        const key = deriveKey(conversationId);
        const encrypted = CryptoJS.AES.encrypt(content, key).toString();
        return `ENC:${encrypted}`;
    } catch (error) {
        console.error('Encryption failed:', error);
        return content;
    }
};

/**
 * Decrypts an encrypted message payload using AES-256
 */
exports.decryptMessage = (payload, conversationId) => {
    if (!payload || !conversationId || typeof payload !== 'string' || !payload.startsWith('ENC:')) return payload;
    try {
        const key = deriveKey(conversationId);
        const ciphertext = payload.replace('ENC:', '');
        const bytes = CryptoJS.AES.decrypt(ciphertext, key);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        return decrypted || '[Decryption Failed]';
    } catch (error) {
        console.error('Decryption failed:', error);
        return payload;
    }
};
