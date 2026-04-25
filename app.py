import os
import json
import uuid
from datetime import datetime
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room

# ---------- 应用初始化 ----------
app = Flask(__name__)
app.config['SECRET_KEY'] = os.urandom(24)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# ---------- 数据存储（内存） ----------
guestbook_messages = []       # 留言板
chat_messages = []            # 聊天室历史（最多保留 200 条）
online_users = {}             # sid -> username

MAX_CHAT_HISTORY = 200

# ---------- 工具函数 ----------
def generate_id():
    return uuid.uuid4().hex[:12]

def current_time():
    return datetime.now().isoformat()

def broadcast_user_list():
    """广播当前在线用户列表（可选）"""
    users = list(set(online_users.values()))
    socketio.emit('user_list', {'users': users})

# ---------- 路由：前端页面 ----------
@app.route('/')
def index():
    return render_template('index.html')

# ---------- API：留言板 ----------
@app.route('/api/guestbook', methods=['GET'])
def get_guestbook():
    """获取留言列表（分页）"""
    offset = request.args.get('offset', 0, type=int)
    limit = request.args.get('limit', 20, type=int)
    total = len(guestbook_messages)
    # 按时间倒序（最新的在前）
    sorted_msgs = sorted(guestbook_messages, key=lambda x: x['created_at'], reverse=True)
    page = sorted_msgs[offset:offset+limit]
    return jsonify({
        'success': True,
        'messages': page,
        'total': total,
        'offset': offset,
        'limit': limit
    })

@app.route('/api/guestbook', methods=['POST'])
def post_guestbook():
    """发布留言"""
    data = request.get_json()
    username = data.get('username', '匿名').strip()
    content = data.get('content', '').strip()

    if not content:
        return jsonify({'success': False, 'error': '内容不能为空'}), 400
    if len(content) > 500:
        return jsonify({'success': False, 'error': '内容过长'}), 400

    msg = {
        'id': generate_id(),
        'username': username[:20] if username else '匿名',
        'content': content,
        'created_at': current_time()
    }
    guestbook_messages.append(msg)
    return jsonify({'success': True, 'message': msg}), 201

# ---------- API：聊天历史 ----------
@app.route('/api/chat/history', methods=['GET'])
def chat_history():
    """获取最近聊天记录（默认返回 100 条）"""
    limit = request.args.get('limit', 100, type=int)
    recent = chat_messages[-limit:] if len(chat_messages) > limit else chat_messages
    return jsonify({'success': True, 'messages': recent})

# ---------- WebSocket 事件处理 ----------
@socketio.on('connect')
def handle_connect():
    """客户端连接"""
    print(f'客户端连接: {request.sid}')
    # 初始化在线用户（等待 update_username）
    online_users[request.sid] = None

@socketio.on('disconnect')
def handle_disconnect():
    """客户端断开"""
    username = online_users.pop(request.sid, None)
    if username:
        # 广播离开消息
        leave_msg = {
            'type': 'system',
            'content': f'{username} 离开了聊天室',
            'username': '系统',
            'created_at': current_time()
        }
        socketio.emit('receive_message', leave_msg)
        broadcast_user_list()
    print(f'客户端断开: {request.sid}')

@socketio.on('update_username')
def handle_update_username(data):
    """更新用户昵称"""
    old_name = online_users.get(request.sid)
    new_name = data.get('username', '用户').strip()[:20]

    # 如果昵称没变，不处理
    if old_name == new_name:
        return

    online_users[request.sid] = new_name

    # 如果是新用户加入（之前未设置昵称），广播加入消息
    if not old_name:
        join_msg = {
            'type': 'system',
            'content': f'{new_name} 加入了聊天室',
            'username': '系统',
            'created_at': current_time()
        }
        socketio.emit('receive_message', join_msg)
    # 如果改名字，可广播改名通知（此处省略）
    broadcast_user_list()

@socketio.on('send_message')
def handle_send_message(data):
    """处理聊天消息"""
    username = online_users.get(request.sid, '用户')
    content = data.get('content', '').strip()

    if not content or len(content) > 500:
        return

    # 构造消息
    msg = {
        'type': 'chat',
        'username': username,
        'content': content,
        'created_at': current_time()
    }

    # 存储到历史记录
    chat_messages.append(msg)
    if len(chat_messages) > MAX_CHAT_HISTORY:
        chat_messages.pop(0)

    # 广播给所有连接的客户端（包括发送者）
    socketio.emit('receive_message', msg)

# ---------- 启动服务器 ----------
if __name__ == '__main__':
    print(" 服务器启动中...")
    print(" 留言板API: http://localhost:5000/api/guestbook")
    print(" 聊天室WebSocket: ws://localhost:5000")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)