import asyncio
import json
from nats.aio.client import Client as NATS

async def test_nats_connection():
    nc = NATS()
    
    try:
        # 连接到 NATS 服务器
        print("🔗 连接到 NATS 服务器...")# 账号密码：root 16!8#6QNy12sFtq  127.0.0.1:4222
        await nc.connect(servers=["nats://127.0.0.1:4222"],user="root",password="16brew#6QNy12sFtq")
        print("✅ 连接成功")
        
        # 测试订阅
        received_messages = []
        
        async def test_handler(msg):
            data = msg.data.decode('utf-8')
            received_messages.append(data)
            print(f"📨 收到测试消息: {data}")
        
        # 订阅测试主题
        await nc.subscribe("test", cb=test_handler)
        print("✅ 已订阅测试主题")
        
        # 发送测试消息
        test_msg = {"test": "hello"}
        await nc.publish("test", json.dumps(test_msg).encode())
        print("✅ 已发送测试消息")
        
        # 等待一下
        await asyncio.sleep(1)
        
        if received_messages:
            print("✅ 测试成功 - 消息被正确接收")
        else:
            print("❌ 测试失败 - 没有收到消息")
            
    except Exception as e:
        print(f"❌ 测试失败: {e}")
    finally:
        await nc.drain()

if __name__ == "__main__":
    asyncio.run(test_nats_connection()) 