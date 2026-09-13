import pool from '../../../config/db';

export class MetaDeduplicationService {
  /**
   * Atomically records an incoming messageId.
   * Returns true if duplicate (already processed), false if new and successfully recorded.
   */
  public static async isDuplicateAndRecord(
    channel: 'whatsapp' | 'instagram',
    messageId: string,
    senderId: string
  ): Promise<boolean> {
    if (!messageId) {
      return false; // If messageId is missing, cannot deduplicate by ID
    }

    try {
      const sql = `
        INSERT INTO chatbot_processed_messages (channel, message_id, sender_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (channel, message_id) DO NOTHING
        RETURNING id;
      `;
      const res = await pool.query(sql, [channel, messageId, senderId]);

      // If rows.length === 0, it means the ON CONFLICT DO NOTHING was triggered (already exists)
      const isDuplicate = res.rows.length === 0;

      if (isDuplicate) {
        console.log(`[MetaDeduplication] Message duplicate detected: ${channel}/${messageId}. Skipping processing.`);
      }

      return isDuplicate;
    } catch (error) {
      console.error('[MetaDeduplication] Database error during message deduplication:', error);
      // Fail-open or fail-safe: return false to allow processing rather than dropping
      return false;
    }
  }
}
