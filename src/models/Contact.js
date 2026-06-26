const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Contact = sequelize.define('Contact', {
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
  peerId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  peerName: {
    type: DataTypes.STRING,
    allowNull: true
  },
  peerPhone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  lastMessageTime: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: DataTypes.NOW
  },
  profilePicture: {
    type: DataTypes.STRING,
    allowNull: true
  },
  about: {
    type: DataTypes.STRING,
    allowNull: true
  },
  isBlocked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  metadata: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'contacts',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['accountPhone', 'peerId']
    },
    {
      fields: ['peerPhone']
    },
    {
      fields: ['lastMessageTime']
    }
  ]
});

module.exports = Contact;