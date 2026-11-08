#NOTE: project này 100% vide code, chủ tút đ biết gì về code 
# Remielle – Gemini Companion

Extension Chrome thêm nhân vật Remielle vào https://gemini.google.com.

| GIF | Khi nào hiển thị |
| --- | --- |
| `kiss.gif` | Luôn hiển thị ở góc dưới bên trái |
| `leisure1.gif` ↔ `leisure2.gif` | Gemini rảnh – mỗi GIF chạy hết 1 vòng rồi đổi sang GIF kia |
| `think.gif` | Gemini đang suy nghĩ (đã gửi câu hỏi, chưa có chữ trả lời) |
| `write.gif` | Gemini đang viết câu trả lời ra |
| `impress.gif` | Gemini vừa trả lời xong (phát 4 vòng ~10s rồi về trạng thái rảnh) |

## Cài đặt
1. Mở `chrome://extensions`, bật **Developer mode**.
2. Bấm **Load unpacked** → chọn thư mục `gemini-remielle`.
3. Mở lại / tải lại tab Gemini.

## Sử dụng
- Nhấn vào nhân vật: hiệu ứng jelly/wobble đàn hồi.
- Kéo thả để di chuyển, nhấp đúp để đưa về vị trí mặc định.
- Bấm icon extension để bật/tắt, **khóa vị trí**, đổi kích thước, độ trong suốt, đặt lại vị trí mặc định.

## Cách nhận biết trạng thái
- **Đang bận**: nút Stop ở ô nhập đang hiện, hoặc vừa gửi câu hỏi, hoặc chữ câu trả lời cuối cùng đang tăng lên.
- **Viết**: câu trả lời mới đã có chữ (không tính phần "suy nghĩ" của model). Ngược lại là **Suy nghĩ**.
- **Rảnh**: không có các dấu hiệu trên (chờ ~0.9s để tránh nháy).
