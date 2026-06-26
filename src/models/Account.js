const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Account = sequelize.define('Account', {
  id: {
    type: DataTypes.BIGINT,
 
    primaryKey: true
  },
  mark: {
    type: DataTypes.STRING,
    allowNull: false
  },
  sessionId:{
    type:DataTypes.STRING,
    allowNull: true
  },
  proxy:{
    type:DataTypes.STRING,
    allowNull: true
  },
  phoneNumber: {
    type: DataTypes.STRING,
    allowNull: true
  },
  socket_status: {
    type: DataTypes.ENUM(
      'disconnected',    // Initial state or after manual disconnect
      'connecting',      // QR code generated, waiting for scan
      'connected',       // Successfully connected
      'logged_out',      // User logged out
      'error'           // Connection error occurred
    ),
    defaultValue: 'disconnected'
  },
  account_status: {
    type: DataTypes.ENUM(
        "unconnected",
      'expired',
      'normal',    // Initial state or after manual disconnect
      'banned',      // QR code generated, waiting for scan
           // Successfully connected

    ),
    defaultValue: 'unconnected'
  },
  lastActive: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'accounts',
  timestamps: true,
  indexes: [
    {
      name: 'idx_phone_number',
      fields: ['phoneNumber'],
      unique: true
    }
  ],
  hooks: {
    beforeSave: (account) => {
      account.lastActive = new Date();
    }
  }
});

module.exports = Account;