const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.BIGINT,

    primaryKey: true
  },
  accountId: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  chatId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  messageType: {
    type: DataTypes.ENUM('text', 'image', 'video', 'audio', 'document', 'location', 'contact'),
    defaultValue: 'text'
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  mediaUrl: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'sent', 'delivered', 'read', 'failed'),
    defaultValue: 'pending'
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'messages',
  timestamps: true,
  indexes: [
    {
      fields: ['accountId']
    },
    {
      fields: ['chatId']
    }
  ]
});

module.exports = Message;