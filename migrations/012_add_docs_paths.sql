-- Add docs_site_url and docs_local_path columns to courses table
-- docs_site_url: stores the site_url from mkdocs.yml for relative path resolution
-- docs_local_path: stores the local path to serve docs (e.g., /docs/repo_name/site/)

ALTER TABLE courses ADD COLUMN docs_site_url TEXT;
ALTER TABLE courses ADD COLUMN docs_local_path TEXT;
