# Reference scenarios for the Feed domain. Spec: docs/usecases/feed.md
# Scenarios tagged @ui describe front-end behavior; @system describe behavior with no user action.
Feature: Feeds and their items

  Background:
    Given I am signed in

  # FD-PREVIEW
  Scenario: Preview before subscribing
    When I enter a feed address and ask for a preview
    Then I see the feed title, its description if any, and the titles of its entries
    And nothing is subscribed or stored

  # FD-PREVIEW-2
  Scenario Outline: A preview that fails
    When I preview an address and <problem>
    Then I see the reason
    And nothing is stored

    Examples:
      | problem                   |
      | it cannot be fetched      |
      | it is not a valid feed    |

  # FD-SUB
  Scenario: Subscribe to a feed
    Given my retention setting is 100
    When I confirm a subscription to "https://example.com/feed.xml"
    Then the feed is added with the title from its source
    And its newest 100 entries are imported as unread

  # FD-SEL-3
  Scenario: The initial import follows my retention
    Given my retention setting is 30
    And a feed lists 100 entries
    When I subscribe
    Then the 30 most recently published entries are imported

  # FD-SEL-2
  Scenario: Duplicate entries in the source are imported once
    Given a feed lists the same article twice
    When I subscribe
    Then the article is imported once

  # FD-SUB-4
  Scenario: A feed with no entries
    When I subscribe to a feed that lists nothing
    Then the subscription is created with no articles

  # FD-SUB-1, FD-ID-1
  Scenario: Subscribe to a feed I already follow
    Given I follow "https://example.com/feed.xml"
    When I subscribe to "https://example.com/feed.xml?utm_source=x#top"
    Then nothing is fetched
    And I am told the feed exists, with the id of the existing feed

  # FD-SUB-3
  Scenario: Importing fails after the feed is created
    When the feed is valid but storing its articles fails
    Then the subscription succeeds with no articles
    And the next scheduled refresh fills it

  # FD-SUB-2
  Scenario: Two requests subscribe to the same feed at once
    When two requests subscribe to the same address at the same moment
    Then one feed is created
    And the other request is told the feed exists

  # FD-ID-2
  Scenario: Items are identified by URL when they have one
    Given a feed item with a URL was imported and I read it
    When the source changes its title
    And the feed is refreshed
    Then there is still one item
    And it is still read

  # FD-ID-3
  Scenario: Items without a URL are identified by title and description
    Given a feed item without a URL was imported
    When the source changes its title
    And the feed is refreshed
    Then the changed entry is a new item

  # FD-ID-4
  Scenario: The same article in two feeds
    Given two of my feeds list the same article
    Then I have two items, one in each feed
    And reading one leaves the other unread

  # FD-IMPORT-5
  Scenario: An entry without a publish time
    When an entry that carries no publish time is imported
    Then its publish time is the time of that sync

  # FD-IMPORT-6
  Scenario: An entry dated in the future
    When an entry dated later than now is imported
    Then its publish time is the time of the import

  # FD-SEL, same rows as the table in the spec
  @system
  Scenario Outline: Refreshing keeps the newest articles
    Given my retention setting is 3
    And the feed stores <stored>
    When the source lists <source> and the feed refreshes
    Then the feed stores <after>

    Examples:
      | stored          | source         | after          |
      | nothing         | t6 t5 t4 t3    | t6 t5 t4       |
      | t5 t4 t3        | t6 t5 t4 t3    | t6 t5 t4       |
      | t5 t4 t3        | t5 t4          | t5 t4 t3       |
      | a@t5 c@t4 d@t3  | b@t5 c@t4 d@t3 | a@t5 b@t5 c@t4 |
      | t5 t4 t3        | t2 t5 t4 t3    | t5 t4 t3       |

  # FD-SEL-4
  @system
  Scenario: Unread articles are not protected by retention
    Given my retention setting is 3
    And the feed stores t5, t4 and t3, and t3 is unread
    When the source lists t6, t5 and t4 and the feed refreshes
    Then t3 is removed

  # FD-SEL-5
  @system
  Scenario: Articles the source dropped stay until retention removes them
    When the source stops listing an article that is within retention
    Then the article stays

  # FD-SEL-7
  Scenario: Lowering retention takes effect at the next refresh
    Given a feed stores 100 articles
    When I set my retention to 30
    Then the feed still stores 100 articles
    When the feed refreshes
    Then the feed stores 30 articles

  # FD-SYNC-1
  @system
  Scenario: Stored articles are not updated from the source
    Given an article is stored
    When the source corrects its content
    And the feed refreshes
    Then the stored article keeps its first content

  # FD-SYNC-2
  @system
  Scenario: A refresh interrupted between writes
    When a refresh fails after adding new articles but before trimming
    Then the feed may hold more than the retention for a while
    And the next refresh trims it

  # FD-SCHED
  @system
  Scenario: Feeds refresh by themselves
    Given I have feeds
    Then each is refreshed at the scheduler's interval, 30 minutes by default
    And a feed that fails to refresh does not stop the others
    And I am not shown the failure
    And there is no way to refresh a feed from its source on demand

  # FD-REFRESH-1, FD-SYNC-5
  @system
  Scenario: A feed removed during a refresh run
    When a feed is unsubscribed while a refresh run is going
    Then its refresh ends without error
    And none of its articles are left behind

  # FD-LIST
  # FD-LIST-1, CM-PAGE-1
  Scenario: List articles from all my feeds
    When I open the subscription list
    Then I see articles from all my feeds, newest published first
    And articles with the same time are ordered by id, larger first

  Scenario: List articles from one feed
    When I select a feed
    Then I see only its articles

  # FD-LIST-2
  Scenario: Select a feed that does not exist
    When I list the articles of a feed that is gone or not mine
    Then I get an empty list, and it is not an error

  # CM-PAGE-8
  Scenario: Show only unread
    When I show only unread
    Then I see only unread articles

  # CM-PAGE-4
  Scenario: Page through the articles
    Given I have more articles than one page holds
    When I list with a page size and then with the returned cursor
    Then I get the following articles without repeats

  # CM-PAGE-7
  Scenario: Changing feed or filter starts over
    Given I am paging through all feeds
    When I select one feed
    Then I list again from the first page without a cursor

  # FD-LIST-3
  Scenario: Feeds are listed by title
    Then my feeds are listed by title, then id

  # FD-OPEN
  Scenario: Open an article
    When I open an article that exists
    Then I get it
    When I open one that does not exist or is not mine
    Then I get nothing, and it is not an error
    And no feed is looked up

  # FD-EXTRACT
  Scenario: Extract an article's page
    Given an article with a URL and no extracted content
    When I ask for the extracted view
    Then the page is fetched and its article extracted
    And the content is stored on the article

  # FD-EXTRACT-2
  Scenario: Reuse extracted content
    Given an article already has extracted content
    When I ask for the extracted view
    Then nothing is fetched

  Scenario: Extract an article without a URL
    When I ask for the extracted view of an article with no URL
    Then I am told it has no original URL

  Scenario Outline: Extraction fails
    When extraction <fails>
    Then I see the reason
    And nothing is stored

    Examples:
      | fails                          |
      | cannot fetch the page          |
      | cannot parse the page          |
      | finds no article content       |

  Scenario: Extract an article that no longer exists
    When I ask for the extracted view of a missing article
    Then I am told the article was not found

  # FD-READ
  Scenario: Mark articles read or unread by id
    When I mark chosen articles read
    Then exactly those are read
    And the unread count of their feed follows

  # FD-READ-1
  Scenario: Marking unknown ids changes nothing
    When I mark ids that do not exist or are not mine
    Then nothing changes and there is no error

  Scenario: Mark a feed read
    When I mark a feed read
    Then every article of that feed is read, loaded or not

  Scenario: Mark all subscription articles read
    When I mark all my subscription articles read
    Then every article of every one of my feeds is read, loaded or not

  # FD-READ-2
  Scenario: Feeds that are not mine are ignored
    When I mark feeds read and include a feed id that is not mine
    Then only my own feeds are affected

  # FD-COUNT
  Scenario: Unread counts
    Given feed A has 3 unread articles and feed B has 4
    Then feed A shows 3 and feed B shows 4
    And the total is 7

  # FD-COUNT-1
  Scenario: A feed with nothing unread
    Given feed C has no unread articles
    Then feed C counts as 0

  # FD-UNSUB
  Scenario: Unsubscribe
    Given I saved one of the feed's articles to read later
    When I unsubscribe
    Then the feed and all its articles are gone
    And the unread counts no longer include it
    And the saved page stays in my read-later list

  # FD-UNSUB-2
  Scenario: Unsubscribe is idempotent
    When I unsubscribe from a feed that does not exist or is not mine
    Then nothing changes and there is no error

  # FD-OWN
  Scenario: Feeds are private
    Given another user has feeds
    Then I never see, read, mark or remove theirs

  # ---- front-end behavior (not business rules) ----

  @ui
  Scenario: Subscribing is a preview, then a confirmation
    When I enter an address and preview it
    Then I can confirm to subscribe or go back and edit
    And after subscribing I land on the new feed

  @ui
  Scenario: A feed I already follow opens
    When I subscribe to a feed I already follow
    Then the existing feed is shown

  @ui
  Scenario: Unsubscribing asks for confirmation
    When I choose to unsubscribe
    Then I am told that saved read-later pages are kept
    And I must confirm

  @ui
  Scenario: Opening an article marks it read but keeps it listed
    Given I am viewing the unread list
    When I open an article
    Then it becomes read
    And it stays in the list, shown as read, until I reload the list

  @ui
  Scenario: The list reloads only on entering, switching or an explicit refresh
    Then the list is reloaded when I enter it, select a feed, change the filter, or press refresh
    And it is not reloaded in the background

  @ui
  Scenario: Saving is offered only for articles with a URL
    Given an article has no URL
    Then saving it to read later is not offered
