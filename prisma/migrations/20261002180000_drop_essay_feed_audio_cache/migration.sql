-- Drop the /feed TTS cache table introduced by #421. Safe if the table
-- was never created (local DBs that never ran the add migration).
-- Does not touch TinkerUserData (essay-feed-stars and other blobs stay).

DROP INDEX IF EXISTS "EssayFeedAudioCache_userId_idx";
DROP TABLE IF EXISTS "EssayFeedAudioCache";
