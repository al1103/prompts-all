# SRT → prompt ảnh whiteboard (bản Vercel)

Chỉ làm **một việc**: AI tạo prompt ảnh từ file phụ đề `.srt`. AI đọc hiểu lời thoại, tự chia cảnh, quyết mỗi cảnh cần mấy vật thể và viết mô tả hình ảnh. Kết quả là tiền tố / hậu tố / danh sách dòng để dán vào tool tạo ảnh hàng loạt, kèm `plan.json`.

Không có chế độ dán tay hay chế độ quy tắc không AI; cảnh nào AI trả không đạt (sau 2 lần hỏi lại và model dự phòng) mới tạm dùng quy tắc dấu câu.

- Model mặc định `deepseek-v4-flash`, dự phòng `gpt-6-astra`.
- Khóa API **không bao giờ** nằm trong JS của trang: nằm ở biến môi trường của Vercel hoặc do người dùng tự nhập (chỉ qua HTTPS, không lưu ở máy chủ).

```
public/index.html   một trang duy nhất: chọn SRT → thiết lập → "Tạo prompt bằng AI" → kết quả (trình duyệt tự cắt lời, chia cảnh, kiểm tra kết quả AI, hỏi lại khi sai)
api/llm.js          chuyển tiếp TỪNG lượt gọi AI tới LLM_BASE_URL cố định
api/status.js       cho trang biết máy chủ có khóa chưa, có cần mật khẩu không
lib/common.js       kiểm tra an toàn dùng chung (mật khẩu, Origin, HTTPS, giới hạn, che khóa trong lỗi)
vercel.json         cấu hình Vercel (thư mục public, maxDuration của api/llm.js)
dev-server.js       chạy thử cục bộ giống Vercel
```

## Deploy
1. Đẩy repo này lên GitHub **riêng tư**.
2. vercel.com → **Add New → Project → Import** repo → Framework Preset **Other** → để trống Build Command → **Deploy**.
3. **Settings → Environment Variables** rồi **Redeploy**: đặt `LLM_BASE_URL` (bắt buộc). Xem `.env.example` cho các biến còn lại.
4. Mỗi lần `git push`, Vercel tự deploy lại.

## Cấp khóa
| Cách | Cấu hình | Ai trả tiền |
|---|---|---|
| Người dùng tự nhập khóa (khuyên dùng) | để trống `LLM_API_KEY` và `APP_PASSWORD` | từng người |
| Khóa của bạn | đặt `LLM_API_KEY` **và** `APP_PASSWORD` dài | bạn |

Với khóa của bạn: giới hạn lượt gọi / sai mật khẩu chỉ có tác dụng trong một instance (serverless không chia sẻ bộ nhớ). Hãy bật thêm **Vercel Firewall → rate limiting** cho `/api/llm` nếu gói của bạn có.

## Chạy thử cục bộ
```
LLM_BASE_URL=https://<host>/v1 node dev-server.js     # http://localhost:3000
```

## Lưu ý
- `vercel.json` đặt `maxDuration` 60 giây cho `api/llm.js`. Nếu gói Vercel của bạn giới hạn thấp hơn, hạ giá trị này hoặc đặt `MAX_SCENES_PER_CALL=2`.
- Gói Hobby của Vercel dành cho dùng cá nhân, phi thương mại (theo điều khoản của họ).
- Nội dung SRT đi qua hàm của bạn rồi tới dịch vụ AI; hàm không lưu gì và không ghi nội dung vào log.
- Chưa được thử deploy thật lên Vercel; hàm đã chạy thử bằng `dev-server.js` (Node 22).
