# Fill Assistant V2.0

Bản này được viết lại sạch hơn để dùng vận hành thử hằng ngày.

## Đã giữ dữ liệu
- Cấu hình máy / slot / sản phẩm.
- Tồn cabin ban đầu.
- Lịch sử Fill nếu có trong bản trước hoặc localStorage cũ.
- Lịch sử NCC nếu có trong bản trước hoặc localStorage cũ.
- Lịch sử điều chỉnh nếu có.

## Quy trình nhập liệu

### Fill
Chỉ nhập:
- Ngày
- Máy
- Slot
- Số lượng đã fill

### NCC
Chỉ nhập:
- Ngày
- Máy
- Sản phẩm
- Số lượng thực nhận

Không nhập số đã đặt vì NCC có thể giao thiếu.

## Cabin

```text
Tồn cabin = Tồn ban đầu + NCC thực nhận - Fill + Điều chỉnh
```

Nếu cabin âm:
- App hiển thị 0.
- Tab Kiểm tra sẽ báo lệch.

## Gợi ý đặt NCC

Sản phẩm thường:
- Tồn cabin > 12: đặt 1 thùng = 24.
- Tồn cabin <= 12: đặt 2 thùng = 48.

Aqua/Aquafina:
- Tồn cabin >= 28: đặt 2 thùng = 56.
- Tồn cabin < 28: đặt 3 thùng = 84.

## Tính năng mới V2.0
- Giao diện dựng lại sạch hơn.
- Có Fill nhanh theo máy.
- Tổng hợp đặt NCC có nút Copy đơn.
- Cảnh báo số lượng nhập bất thường.
- Giữ Sửa / Xóa / Hoàn tác.
- Có Đối chiếu kiểm kê.

## Cập nhật lên GitHub Pages
1. Giải nén ZIP.
2. Upload toàn bộ file lên repository, ghi đè file cũ.
3. Đợi GitHub Pages deploy.
4. Mở lại link trên điện thoại.
5. Nếu vẫn thấy giao diện cũ, refresh nhiều lần hoặc xóa cache website.

## Sao lưu
Nên vào tab Sao lưu → Xuất dữ liệu JSON sau mỗi ngày vận hành.
