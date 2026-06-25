# Fill Assistant V2.0

Bản dựng lại sạch hơn, giữ logic nghiệp vụ đã chốt.

## Dữ liệu đã giữ lại
- Cấu hình máy / slot / sản phẩm từ bản trước.
- Tồn cabin ban đầu.
- Dữ liệu Fill đã nhập.
- Dữ liệu NCC đã nhập.
- Dữ liệu điều chỉnh nếu có.

## Logic chính

### Chỉ nhập 2 nghiệp vụ chính
1. Fill: ngày, máy, slot, số lượng đã fill.
2. NCC: ngày, máy, sản phẩm, số lượng thực nhận.

### Cabin
```text
Tồn cabin = Tồn ban đầu + NCC thực nhận - Fill + Điều chỉnh
```

### Cabin âm
- Không hiển thị số âm.
- Hiển thị 0 và báo lệch trong tab Kiểm tra.

### Đặt NCC
Sản phẩm thường:
- Cabin > 12: đặt 1 thùng = 24.
- Cabin <= 12: đặt 2 thùng = 48.

Aqua/Aquafina:
- Cabin >= 28: đặt 2 thùng = 56.
- Cabin < 28: đặt 3 thùng = 84.

## Cập nhật lên GitHub Pages
1. Giải nén ZIP.
2. Upload toàn bộ file trong thư mục lên repository GitHub.
3. Ghi đè file cũ.
4. Đợi GitHub Pages deploy lại.
5. Trên điện thoại, nếu vẫn thấy bản cũ: mở Chrome/Safari refresh vài lần hoặc xóa cache trang.

## Sao lưu
Nên vào tab Sao lưu → Xuất dữ liệu JSON cuối ngày.
