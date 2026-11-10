Feature: Subscriptions
  As a signed-in user
  I want to subscribe to RSS/Atom feeds
  So that new articles are collected for me

  Background:
    Given I am signed in

  Scenario: Preview a feed before subscribing
    When I enter a feed URL and request a preview
    Then I see the feed title, its description if any, and the titles of its articles
    And no subscription is created
    And I can then confirm to subscribe

  Scenario: Preview fails
    When I request a preview for a URL that cannot be fetched or parsed
    Then I see "Unable to fetch the feed" or "Unable to parse the feed"
    And no subscription is created

  Scenario: Subscribe to a feed
    When I subscribe to "https://example.com/feed.xml"
    Then the feed appears in my subscriptions with its title
    And its 30 newest articles are imported as unread
    And the feed is selected

  Scenario: Initial import is capped
    Given a feed contains 100 articles
    When I subscribe to it
    Then only the 30 most recently published articles are imported

  Scenario: Duplicate articles in a feed are imported once
    Given a feed lists the same article twice
    When I subscribe to it
    Then the article is imported once

  Scenario: Reject a non-HTTP feed URL
    When I subscribe to "ftp://example.com/feed.xml"
    Then I see "Feed URL must use HTTP or HTTPS"

  Scenario: Subscribe to a feed I already follow
    Given I am subscribed to "https://example.com/feed.xml"
    When I subscribe to it again
    Then I am told the subscription already exists
    And the existing subscription is shown

  Scenario: Feed cannot be fetched or parsed
    When I subscribe to a feed that cannot be fetched or parsed
    Then I see "Unable to fetch the feed" or "Unable to parse the feed"
    And no subscription is created

  Scenario: Article import fails after the feed is created
    Given the feed was created
    When importing its articles fails
    Then I see "Failed to import feed articles"
    And the subscription is kept so that I can refresh it later

  Scenario: Refresh a feed adds new articles
    Given I am subscribed to a feed
    And the feed now has articles I have not seen
    When I refresh the feed
    Then the new articles are added as unread
    And existing articles keep their read state
    And the feed title is updated from the source

  Scenario: Refresh a feed that no longer exists
    When I refresh a subscription that was removed
    Then I see "Feed not found"

  Scenario: Retention limits stored articles
    Given my retention setting is 50
    And a feed has more than 50 stored articles after a refresh
    When the feed is refreshed
    Then only the 50 most recently published articles are kept

  @known-gap
  Scenario: Unread articles are not removed by retention
    Given my retention setting is 30
    And a feed has 40 articles of which some beyond the newest 30 are unread
    When the feed is refreshed
    Then unread articles are kept
    And only read articles beyond the retention limit are removed
    # Current code trims by publish date only, regardless of read state.

  Scenario: Feeds refresh automatically
    Given I have subscriptions
    Then each of my feeds is refreshed about every 30 minutes
    And a failing feed does not stop the others from refreshing

  Scenario: Unsubscribe
    Given I am subscribed to a feed with articles
    And I saved one of its articles to read later
    When I unsubscribe
    Then the subscription and all its articles disappear
    And the unread counts are updated
    And the saved page stays in my read-later list

  Scenario: Unsubscribe from the open feed
    Given I am viewing the articles of a feed
    When I unsubscribe from that feed
    Then I am shown the list of all subscription articles

  Scenario: Unsubscribe from a feed that does not exist
    When I unsubscribe from a feed that was already removed
    Then I see "Feed not found"

  Scenario: Subscriptions are private
    Given another user has subscriptions
    When I list my subscriptions
    Then I never see theirs
