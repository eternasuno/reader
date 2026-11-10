# Reference scenarios for the SavedPage domain. Spec: docs/usecases/saved-page.md
# Scenarios tagged @ui describe front-end behavior; they are not business rules.
Feature: Saved pages (read later)

  Background:
    Given I am signed in

  # SP-ADD
  Scenario: Add a link
    When I add "https://example.com/post?utm_source=x#top"
    Then the page is fetched and its article is extracted
    And it is saved with the address "https://example.com/post"
    And it is unread
    And it appears at the position of its publish time

  # SP-ADD-4
  Scenario: A page without a publish time
    When I add a link whose page has no publish time
    Then the time of adding is used as its publish time

  # SP-ADD-1, SP-ID-1, CM-URL
  Scenario: Add a link already saved
    Given "https://example.com/post" is saved
    When I add "https://example.com/post?utm_campaign=y#comments"
    Then nothing is fetched
    And nothing new is saved
    And I am told it is already saved, with the id of the existing page

  # SP-ADD-3
  Scenario Outline: A link that cannot be saved
    When I add a link and <problem>
    Then I see the reason
    And nothing is saved

    Examples:
      | problem                              |
      | the page cannot be fetched           |
      | the page cannot be parsed            |
      | the page has no readable content     |

  # SP-ADD-5
  Scenario: Two requests add the same link at once
    When two requests add the same link at the same moment
    Then one page is saved
    And the other request is told it is already saved

  # SP-SAVE
  Scenario: Save a feed article
    Given a feed article with a URL
    When I save it to read later
    Then a copy is saved, unread
    And the copy keeps the article's title, description and publish time
    And the feed article is unchanged

  # SP-SAVE-5
  Scenario Outline: Which content the copy uses
    Given a feed article <has>
    When I save it
    Then the copy uses <content>

    Examples:
      | has                                         | content                          |
      | extracted content                           | the extracted content            |
      | feed content but no extracted content       | the feed content                 |
      | neither, but a URL                          | content extracted from the URL   |

  # SP-SAVE-1
  Scenario: A feed article without a URL cannot be saved
    Given a feed article has no URL
    When I try to save it
    Then I am told it has no original URL
    And nothing is saved

  # SP-SAVE-3
  Scenario: Save a feed article already saved
    Given the article's URL is already in my read-later list
    When I save the article
    Then nothing is fetched
    And I am told it is already saved

  # SP-SAVE-4
  Scenario: The saved copy is independent
    Given I saved a feed article
    When I mark the saved page read
    Then the feed article stays unread

  # SP-LIST
  Scenario: List newest published first
    Given I have saved pages
    When I open the read-later list
    Then pages are ordered by publish time, newest first
    And pages with the same time are ordered by id, larger first

  Scenario: Show only unread
    Given I have read and unread pages
    When I show only unread
    Then I see only unread pages
    When I show all
    Then I see every page

  # SP-LIST-4, CM-PAGE
  Scenario: Page through the list
    Given I have more pages than one page holds
    When I list with a page size of 30
    Then I get 30 pages and a cursor
    When I list again with that cursor
    Then I get the next pages without repeats
    And the last page carries no cursor

  # CM-PAGE-6
  Scenario: A cursor survives the deletion of its page
    Given I have a cursor pointing at a page
    When that page is removed
    And I list with the cursor
    Then I get the pages after that position

  # SP-RELOAD, CM-PAGE-7
  Scenario: Changing the filter starts over
    Given I am paging through all pages
    When I show only unread
    Then I list again from the first page without a cursor

  # SP-RELOAD-2
  Scenario: Reload shows the current state
    Given I listed unread pages and then read one and saved another
    When I list again from the first page
    Then the page I read is gone
    And the new page is at its position

  # SP-OPEN
  Scenario: Open a saved page
    When I open a page that exists
    Then I get it
    When I open a page that does not exist or is not mine
    Then I get nothing, and it is not an error

  # SP-READ
  Scenario: Mark pages read or unread by id
    When I mark chosen pages read
    Then exactly those pages are read
    When I mark them unread
    Then they are unread again

  Scenario: Marking unknown ids changes nothing
    When I mark ids that do not exist or are not mine
    Then nothing changes and there is no error

  Scenario: Mark all saved pages read
    When I mark all saved pages read
    Then every saved page of mine is read, loaded or not

  # SP-READ-3
  Scenario: Reading everything across the library is two calls
    When I mark all unread articles read
    Then the saved pages and the feed articles are marked by their own operations

  # SP-REMOVE
  Scenario: Remove a saved page
    When I remove a page
    Then it is gone from the list
    And the unread count updates

  Scenario: Remove is idempotent
    When I remove a page that does not exist
    Then nothing changes and there is no error

  # SP-REMOVE-2
  Scenario: Save again after removing
    Given I removed a page
    When I add the same link again
    Then it is saved as a new unread page

  # SP-COUNT
  Scenario: Unread count
    Given I have 3 unread and 2 read pages
    Then the unread count is 3

  # SP-OWN
  Scenario: Saved pages are private
    Given another user saved pages
    Then I never see, mark or remove them

  # ---- front-end behavior (not business rules) ----

  @ui
  Scenario: Opening a page marks it read but keeps it in the list
    Given I am viewing the unread list
    When I open a page
    Then it becomes read
    And it stays in the list, shown as read, until I reload the list

  @ui
  Scenario: The list reloads only on entering, switching or an explicit refresh
    Then the list is reloaded when I enter it, change the filter, or press refresh
    And it is not reloaded in the background
    And it is not reloaded when I come back from reading

  @ui
  Scenario: Refresh is ignored while a request is in flight
    Given a read mark or a delete is still being sent
    When I press refresh
    Then nothing is reloaded

  @ui
  Scenario: A duplicate opens the existing page
    When I add a link that is already saved
    Then the existing page is opened
