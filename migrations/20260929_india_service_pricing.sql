ALTER TABLE services
  ADD COLUMN price_min_inr DECIMAL(10,2),
  ADD COLUMN price_max_inr DECIMAL(10,2),
  ADD CONSTRAINT chk_services_inr_price_band CHECK (
    (price_min_inr IS NULL AND price_max_inr IS NULL) OR
    (price_min_inr IS NOT NULL AND price_max_inr IS NOT NULL AND
      price_min_inr >= 0 AND price_max_inr >= price_min_inr)
  );

START TRANSACTION;

UPDATE services
SET title = 'Men''s & Boys'' Haircut',
    description = 'A sharp, considered haircut for boys and men.',
    price_min_inr = 500,
    price_max_inr = 500
WHERE title = 'Haircut';

UPDATE services
SET title = 'Men''s Facial',
    description = 'A restorative facial tailored for men, from a quick refresh to a deeper treatment.',
    price_min_inr = 800,
    price_max_inr = 4999
WHERE title = 'Facial';

UPDATE services
SET price_min_inr = 300,
    price_max_inr = 300
WHERE title = 'Beard Grooming';

UPDATE services
SET price_min_inr = 4083,
    price_max_inr = 4083
WHERE title = 'Spa Treatments';

INSERT INTO services
  (provider_id, title, description, price, price_min_inr, price_max_inr, duration_minutes)
SELECT haircut.provider_id, 'Girls'' Haircut',
       'A careful cut and finish, with time to find the right style.',
       haircut.price, 500, 1000, haircut.duration_minutes
FROM services haircut
WHERE haircut.title = 'Men''s & Boys'' Haircut'
  AND NOT EXISTS (
    SELECT 1 FROM services existing
    WHERE existing.provider_id = haircut.provider_id
      AND existing.title = 'Girls'' Haircut'
  );

COMMIT;