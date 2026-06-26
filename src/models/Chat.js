const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Chat = sequelize.define('Chat', {
  id: {
    type: DataTypes.BIGINT,
   
    primaryKey: true
  },
  accountId: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  accountPhone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  peerPhone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  peerId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  peerName: {
    type: DataTypes.STRING,
  },
  isGroup: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  lastMessage: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  lastMessageTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
}, {
  tableName: 'chats',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['accountPhone', 'peerId']
    },
  ],
  hooks: {
    beforeSave: (chat) => {
     
    }
  }
});

module.exports = Chat;