# Fill Assistant V2.1

Project PWA chuẩn để upload trực tiếp lên GitHub Pages.

## Có gì trong bản này

- Dashboard hoàn chỉnh.
- Tổng hợp đặt NCC hiển thị ngay trên Dashboard.
- Nút Copy đơn NCC.
- Fill nhanh theo máy.
- Nhập Fill thủ công.
- Nhập NCC thực nhận.
- Sửa / Xóa / Hoàn tác cho Fill, NCC, Điều chỉnh.
- Kiểm tra cabin âm.
- Đối chiếu kiểm kê.
- Responsive cho điện thoại.
- Dữ liệu ngày 25 và dữ liệu Fill/NCC cũ được giữ trong `data.js`.

## Cấu trúc project

```text
index.html
styles.css
app.js
data.js
manifest.json
sw.js
README.md
TEST_REPORT.md
icon-192.png
icon-512.png
```

## Quy tắc dữ liệu

Cabin hiện tại:

```text
Tồn cabin = Tồn ban đầu + NCC thực nhận - Fill + Điều chỉnh
```

Cabin âm:
- Không hiển thị âm.
- Hiển thị 0.
- Tab Kiểm tra báo lệch.

## Gợi ý đặt NCC

Sản phẩm thường:
- Tồn cabin > 12: đặt 1 thùng = 24.
- Tồn cabin <= 12: đặt 2 thùng = 48.

Aqua/Aquafina:
- Tồn cabin >= 28: đặt 2 thùng = 56.
- Tồn cabin < 28: đặt 3 thùng = 84.

## Cập nhật GitHub Pages

1. Giải nén ZIP.
2. Upload toàn bộ file trong thư mục lên repository GitHub.
3. Ghi đè file cũ.
4. Chờ GitHub Pages deploy lại.
5. Nếu điện thoại vẫn hiện bản cũ, refresh vài lần hoặc xóa cache website.

## Sao lưu

Trong app vào tab `Sao lưu` → `Xuất dữ liệu JSON`.

Nên sao lưu cuối ngày.


## V2.2 - Copy đơn NCC theo từng máy

Thay đổi phần NCC:
- `Tổng hợp đặt NCC` đổi thành `Đặt NCC theo từng máy`.
- Mỗi máy có nút `Copy <tên máy>`.
- Nút `Copy tất cả` sẽ copy toàn bộ đơn theo từng máy.

Ví dụ nội dung copy:

```text
Đơn NCC D3:
D3
- Aquafina: 2 thùng (56 chai)
- Pepsi: 1 thùng (24 lon)
```

Hoặc copy tất cả:

```text
Đơn NCC theo máy:
D3
- Aquafina: 2 thùng (56 chai)

D8
- Boss: 1 thùng (24 lon)
```


## V2.3 - Dashboard đặt NCC theo tab máy

Thay đổi:
- Phần `Đặt NCC theo từng máy` chuyển sang dạng tab ngang.
- Bấm từng máy để xem đơn NCC của máy đó.
- Mỗi máy vẫn có nút `Copy <tên máy>`.
- Nút `Copy tất cả` vẫn giữ để copy toàn bộ đơn theo máy.


## V2.4 - Sửa logic đặt NCC

Sản phẩm thường:
- Tồn cabin > 24: không đặt.
- Tồn cabin 13-24: đặt 1 thùng = 24 lon/chai.
- Tồn cabin 0-12: đặt 2 thùng = 48 lon/chai.

Aqua/Aquafina:
- Tồn cabin >= 28: đặt 2 thùng = 56 chai.
- Tồn cabin < 28: đặt 3 thùng = 84 chai.

Dashboard chỉ hiển thị sản phẩm thật sự cần đặt.


## V3.0 - Dashboard theo máy tự do

Thay đổi lớn:
- Bỏ tuyến A/B cố định.
- Dashboard có tab chọn 7 máy tự do.
- Chọn máy nào thì chỉ hiển thị:
  - Gợi ý đặt NCC của máy đó.
  - Đơn NCC của máy đó.
  - Hàng bán chậm/đang học của máy đó.
  - Cabin của máy đó.
- Nút Copy đơn chỉ copy đúng máy đang chọn.
- App nhớ máy cuối cùng bạn đang xem.

Dữ liệu Fill/NCC cũ được giữ bằng cơ chế migrate localStorage từ các bản V2.x.


## V3.1 - Kiểm kê cabin ngay trên Dashboard

Thêm chức năng `Kiểm kê cabin` tại máy đang chọn.

Cách dùng:
1. Vào Dashboard.
2. Chọn máy.
3. Ở phần `Cabin máy đang chọn`, bấm `Kiểm kê cabin`.
4. Nhập số tồn thực tế của từng sản phẩm.
5. Bấm `Lưu`.

App tự tính:
```text
Chênh lệch = Tồn thực tế - Tồn app đang tính
```

Sau đó tự tạo bản ghi `Điều chỉnh` với lý do `Kiểm kê`.

Bạn không cần tự tính + hoặc - nữa.
