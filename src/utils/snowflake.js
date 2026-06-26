/**
 * Snowflake ID Generator
 * A distributed ID generation algorithm that generates 64-bit IDs
 */
const snowflake = {
    // Starting timestamp (2023-01-01)
    epoch: 1672531200000n,
    // Number of bits allocated for the sequence
    sequenceBits: 12,
    // Maximum value for sequence
    sequenceMask: -1 ^ (-1 << 12),
    // Left shift for timestamp
    timestampLeftShift: 12,
    // Sequence counter
    sequence: 0,
    // Last timestamp used
    lastTimestamp: -1,
    
    /**
     * Generate next unique ID
     * @returns {number} Generated unique ID
     */
    nextId() {
        let timestamp = BigInt(Date.now());
        
        if (timestamp < BigInt(this.lastTimestamp)) {
            throw new Error('Clock moved backwards. Refusing to generate ID');
        }
        
        if (timestamp === BigInt(this.lastTimestamp)) {
            this.sequence = (this.sequence + 1) & this.sequenceMask;
            if (this.sequence === 0) {
                timestamp = BigInt(this.tilNextMillis(Number(this.lastTimestamp)));
            }
        } else {
            this.sequence = 0;
        }
        
        this.lastTimestamp = Number(timestamp);
        
        const result = ((timestamp - this.epoch) << BigInt(this.timestampLeftShift)) |
            BigInt(this.sequence);
            
        return Number(result);
    },
    
    /**
     * Wait until next millisecond
     * @param {number} lastTimestamp - Last timestamp used
     * @returns {number} - Next timestamp
     */
    tilNextMillis(lastTimestamp) {
        let timestamp = Date.now();
        while (timestamp <= lastTimestamp) {
            timestamp = Date.now();
        }
        return timestamp;
    }
};

module.exports = snowflake; 