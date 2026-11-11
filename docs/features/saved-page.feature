# Reference scenarios for the SavedPage domain. Spec: docs/usecases/saved-page.md
# Scenarios tagged @ui describe front-end behavior; they are not business rules.
Feature: Saved pages (read later)

  Background:
    Given I am signed in

  # SP-ADD, SP-ADD-2, SP-LIST-1
  Scenario: Add a link
    When I add "https://example.com/post?utm_source=x#top"
    Then the page is fetched and its article is extracted
    And it is saved with the address "https://example.com/post"
    And it is unread
    And it is at the top of the list

  # SP-ADD, SP-LIST-1
  Scenario: An old article saved now is at the top
    When I add a link to an article published years ago
    Then the saved page keeps that publish time
    And it is at the top of the list, above pages saved earlier

  # SP-ADD-4, CM-FETCH-1
  Scenario: A page without a publish time
    When I add a link whose page has no publish time
    Then the saved page has no publish time

  # SP-ADD-1, SP-ID-2, SP-ID-4, CM-URL
  Scenario: Add a link already saved
    Given "https://example.com/post" is saved
    When I add "https://example.com/post?utm_campaign=y#comments"
    Then nothing is fetched
    And nothing new is saved
    And I am told it is already saved, with the address of the existing page

  # SP-ADD-2, SP-ADD-1
  Scenario: A link that redirects
    Given "https://a.example/post" redirects to "https://b.example/post"
    When I add "https://a.example/post"
    Then it is saved with the address "https://a.example/post"
    When I add "https://a.example/post" again
    Then nothing is fetched
    And I am told it is already saved

  # SP-ADD-3, CM-FETCH-4
  Scenario Outline: A link that cannot be saved
    When I add a link and <problem>
    Then I see the reason
    And nothing is saved

    Examples:
      | problem                                     |
      | the page cannot be fetched                  |
      | the page cannot be parsed                   |
      | extraction fails with ArticleExtractorError |
      | the page has no readable content            |

  # SP-ADD-5, SP-ID-2
  Scenario: Two requests add the same link at once
    When two requests add the same link at the same moment
    Then one page is saved for that address
    And the other request is told it is already saved, with that address

  # SP-SAVE-2, SP-SAVE-4, SP-SAVE-5, SP-SAVE-9
  Scenario: Save a feed article
    Given a feed article with a URL
    When I save it to read later
    Then a copy is saved, unread
    And the copy keeps the article's title, description and publish time
    And the feed article is unchanged

  # SP-SAVE-9, SP-LIST-1
  Scenario: An old, read article saved gives an unread copy at the top
    Given a read feed article published years ago
    When I save it
    Then the copy is unread, with the article's publish time
    And it is at the top of the list

  # SP-SAVE-8
  Scenario Outline: Which content the copy uses
    Given a feed article with <has>
    When I save it
    Then the copy contains <content>
    And <fetching>

    Examples:
      | has                                                   | content                        | fetching           |
      | extracted content "extracted" and feed content "feed" | "extracted"                    | nothing is fetched |
      | feed content "feed" and no extracted content          | "feed"                         | nothing is fetched |
      | neither extracted nor feed content                    | content extracted from the URL | the URL is fetched |

  # SP-SAVE-6, CM-FETCH-4
  Scenario Outline: A save that must fetch the article and fails
    Given a feed article with neither extracted nor feed content
    When I save it and <problem>
    Then I see the reason
    And nothing is saved

    Examples:
      | problem                                     |
      | the page cannot be fetched                  |
      | extraction fails with ArticleExtractorError |
      | the page has no readable content            |

  # SP-SAVE-10
  Scenario: The article is removed during the save
    Given the save has found the feed article
    And no saved page exists for its URL
    And the article's content is available
    When the feed article is removed before the copy is created
    Then the copy is still saved

  # SP-SAVE-1
  Scenario: Save a feed article that no longer exists
    When I save a feed article that is gone or not mine
    Then I am told the article was not found
    And nothing is saved

  # SP-SAVE-3
  Scenario: Save a feed article already saved
    Given the article's URL is already in my read-later list
    When I save the article
    Then nothing is fetched
    And I am told it is already saved

  # SP-SAVE-4
  Scenario: Marking the copy read leaves the feed article's read state alone
    Given a feed article saved to my read-later list
    When I mark the copy read
    Then the feed article's read state is unchanged

  # SP-SAVE-4
  Scenario: Marking the feed article read leaves the copy's read state alone
    Given a feed article saved to my read-later list
    When I mark the feed article read
    Then the copy's read state is unchanged

  # SP-SAVE-4
  Scenario: Extracting the feed article's content leaves the copy's content alone
    Given a feed article saved to my read-later list
    When the feed article's content is extracted
    Then the copy's content is unchanged

  # SP-SAVE-4, FD-UNSUB-3
  Scenario: Unsubscribing from the feed keeps the copy
    Given a feed article saved to my read-later list
    When I unsubscribe from the feed
    Then the copy stays

  # SP-SAVE-7, SP-ADD-5, SP-ID-2
  Scenario Outline: Concurrent saves of the same URL create one page
    When <requests> at the same moment
    Then one page is saved for that address
    And the other request is told it is already saved, with that address

    Examples:
      | requests                                                    |
      | two requests save the same feed article                     |
      | one request saves a feed article and one adds the same link |

  # SP-LIST-1
  Scenario: List newest saved first
    Given I have saved pages
    When I open the read-later list
    Then pages are ordered newest saved first
    And a page just saved is on top, whatever the age of the article

  # CM-PAGE-8
  Scenario: Show only unread
    Given I have read and unread pages
    When I show only unread
    Then I see only unread pages
    When I show all
    Then I see every page

  # CM-PAGE-4
  Scenario Outline: Page through the list
    Given I have <pages> saved pages
    When I list with a page size of 30
    Then <result>

    Examples:
      | pages | result                                                 |
      | 31    | I get 30 pages and a cursor, then 1 page and no cursor |
      | 30    | I get 30 pages and no cursor                           |

  # CM-PAGE-6
  Scenario: A cursor survives the deletion of its page
    Given I have a cursor pointing at a page
    When that page is removed
    And I list with the cursor
    Then I get the pages after that position

  # CM-PAGE-7
  Scenario: Changing the filter starts over
    Given I am paging through all pages
    When I show only unread
    Then I list again from the first page without a cursor

  # SP-LIST-3
  Scenario: Reload shows the current state
    Given I listed unread pages and then read one and saved another
    When I list again from the first page
    Then the page I read is gone
    And the new page is at the top

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

  # SP-READ-1
  Scenario: Marking unknown ids changes nothing
    When I mark ids that do not exist or are not mine
    Then nothing changes and there is no error

  # SP-READ-2
  Scenario: Marking twice is idempotent
    When I mark a page read and mark it read again
    Then it is read and there is no error

  # SP-READ
  Scenario: Mark all saved pages read
    When I mark all saved pages read
    Then every saved page of mine is read, loaded or not

  # SP-READ
  Scenario: Mark all unread includes pages that are not loaded
    Given I have more unread pages than the list has loaded
    When I mark all saved pages read
    Then every page is read, including those not loaded

  # SP-READ-3
  Scenario: Reading everything across the library is two calls
    When I mark all unread articles read
    Then the saved pages and the feed articles are marked by their own operations

  # SP-REMOVE
  Scenario: Remove a saved page
    When I remove a page
    Then it is gone from the list
    And the unread count updates

  # SP-REMOVE-1
  Scenario: Remove is idempotent
    When I remove a page that does not exist
    Then nothing changes and there is no error

  # SP-REMOVE-2, SP-ID-1
  Scenario: Save again after removing
    Given I removed a page
    When I add the same link again
    Then it gets a new id, different from the removed page's id
    And it is a new unread page
    And it is at the top of the list

  # SP-COUNT
  Scenario: Unread count
    Given I have 3 unread and 2 read pages
    Then the unread count is 3

  # SP-COUNT, SP-REMOVE
  Scenario Outline: Removing a page and the unread count
    Given I have 3 unread and 2 read pages
    When I remove <page>
    Then the unread count is <count>

    Examples:
      | page           | count |
      | an unread page | 2     |
      | a read page    | 3     |

  # SP-OWN
  Scenario: Saved pages are private
    Given another user saved pages
    Then I never see, mark or remove them

  # ---- front-end behavior (not business rules) ----

  @ui
  # front-end behavior: opening a page marks it read
  Scenario: Opening a page marks it read but keeps it in the list
    Given I am viewing the unread list
    When I open a page
    Then it becomes read
    And it stays in the list, shown as read, until I reload the list

  @ui
  # front-end behavior: when the list reloads
  Scenario: The list reloads only on entering, switching or an explicit refresh
    Then the list is reloaded when I enter it, change the filter, or press refresh
    And it is not reloaded in the background
    And it is not reloaded when I come back from reading

  @ui
  # front-end behavior: refresh while a request is in flight
  Scenario: Refresh is ignored while a request is in flight
    Given a read mark or a delete is still being sent
    When I press refresh
    Then nothing is reloaded

  @ui
  # front-end behavior: a duplicate opens the existing page
  Scenario: A duplicate opens the existing page
    When I add a link that is already saved
    Then the existing page is opened
