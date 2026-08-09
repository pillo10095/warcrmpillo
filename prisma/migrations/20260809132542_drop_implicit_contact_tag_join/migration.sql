/*
  Warnings:

  - You are about to drop the `_contacttagjoin` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `_contacttagjoin` DROP FOREIGN KEY `_ContactTagJoin_A_fkey`;

-- DropForeignKey
ALTER TABLE `_contacttagjoin` DROP FOREIGN KEY `_ContactTagJoin_B_fkey`;

-- DropTable
DROP TABLE `_contacttagjoin`;
