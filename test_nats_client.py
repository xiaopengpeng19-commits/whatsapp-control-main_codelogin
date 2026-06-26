import asyncio
import json
import sys
from nats.aio.client import Client as NATS

# NATS 服务器地址
NATS_URL = "nats://localhost:4222"  # 替换为你自己的地址

# 发送的消息体
message = {
    "Cmd": "SendTextMsg",
    "ReqId": "683749af56030ddd5d160f03",
    "Account": "355698125899",
    "Body": {
        "To": "355684088234",
        "Text": "hello"
    }
}

async def main():
    nc = NATS()
    
    try:
        # 连接到 NATS 服务器
        print(f"正在连接到 NATS 服务器: {NATS_URL}")
        await nc.connect(servers=["nats://127.0.0.1:4222"],user="root",password="16brew#6QNy12sFtq")
        print("✅ 成功连接到 NATS 服务器")

        # 订阅 Account 的主题
        subject = "355698125899"
        
        async def message_handler(msg):
            try:
                data = msg.data.decode('utf-8')
                print(f"📨 [收到消息] {msg.subject}: {data}")
                
                # 尝试解析 JSON 响应
                try:
                    json_data = json.loads(data)
                    print(f"📋 解析后的响应: {json.dumps(json_data, indent=2, ensure_ascii=False)}")
                except json.JSONDecodeError:
                    print(f"⚠️  响应不是有效的 JSON 格式: {data}")
                    
            except Exception as e:
                print(f"❌ 处理消息时出错: {e}")

        # 订阅主题
        await nc.subscribe(subject, cb=message_handler)
        print(f"✅ 已订阅主题 '{subject}'")

        # 发布消息到 "cmds"
        print(f"📤 [发送消息] 到 'cmds': {json.dumps(message, indent=2, ensure_ascii=False)}")
        await nc.publish("cmds", json.dumps(message).encode('utf-8'))
        print("✅ 消息已发送到 'cmds' 主题")

        # 等待消息，保持运行
        print("⏳ 等待响应消息... (按 Ctrl+C 退出)")
        try:
            while True:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            print("\n👋 正在退出...")

    except Exception as e:
        print(f"❌ 连接或操作失败: {e}")
        sys.exit(1)
    finally:
        # 关闭连接
        try:
            await nc.drain()
            print("✅ NATS 连接已关闭")
        except Exception as e:
            print(f"⚠️  关闭连接时出错: {e}")

if __name__ == "__main__":
    asyncio.run(main()) 