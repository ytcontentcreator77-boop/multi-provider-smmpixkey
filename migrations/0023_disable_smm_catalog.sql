-- Switch the storefront from SMM services to digital key products without deleting old order history.
UPDATE services SET enabled = 0;
