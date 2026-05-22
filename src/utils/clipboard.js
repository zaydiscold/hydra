/**
 * Utility function to copy text to the clipboard.
 * Attempts to use the modern navigator.clipboard API,
 * with a fallback to document.execCommand('copy') for non-secure contexts.
 *
 * @param {string} text - The text to copy.
 * @returns {Promise<boolean>} - Resolves to true if successful, throws an error if both methods fail.
 */
export async function copyToClipboard(text) {
  try {
    const navClip = navigator.clipboard;
    if (navClip && navClip.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    throw new Error('navigator.clipboard is unavailable');
  } catch (err) {
    console.warn('[CLIPBOARD] navigator.clipboard copy failed:', err.message);
    // Fallback for non-secure contexts (e.g., HTTP in Electron)
    let ta = null;
    let didCopy = false;
    try {
      ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      didCopy = document.execCommand('copy');
      if (!didCopy) throw new Error('execCommand returned false');
      return true;
    } catch (fallbackErr) {
      console.warn('[CLIPBOARD] Fallback copy failed:', fallbackErr.message);
      throw new Error(`Failed to copy to clipboard: ${fallbackErr.message || 'permission denied'}`);
    } finally {
      if (ta?.parentNode) document.body.removeChild(ta);
    }
  }
}
