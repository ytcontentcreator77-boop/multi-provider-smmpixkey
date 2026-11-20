INSERT OR IGNORE INTO payment_methods (id,name,kind,currency,details,enabled,sort) VALUES
('google_pay','Google Pay','manual','INR','',0,20),
('phonepe','PhonePe','manual','INR','',0,21),
('imps','IMPS Bank Transfer','manual','INR','',0,22),
('neft','NEFT Bank Transfer','manual','INR','',0,23),
('wise','Wise Transfer','manual','USD','',0,24),
('paypal_manual','PayPal Manual','manual','USD','',0,25),
('skrill','Skrill','manual','USD','',0,26),
('nagad','Nagad','manual','BDT','',0,27),
('rocket','Rocket','manual','BDT','',0,28),
('jazzcash','JazzCash','manual','PKR','',0,29),
('easypaisa','Easypaisa','manual','PKR','',0,30),
('bank_npr','Nepal Bank Transfer','manual','NPR','',0,31);
